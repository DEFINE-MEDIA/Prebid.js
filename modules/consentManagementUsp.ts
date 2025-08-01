/**
 * This module adds USPAPI (CCPA) consentManagement support to prebid.js. It
 * interacts with supported USP Consent APIs to grab the user's consent
 * information and make it available for any USP (CCPA) supported adapters to
 * read/pass this information to their system.
 */
import {deepSetValue, isNumber, isPlainObject, isStr, logError, logInfo, logWarn} from '../src/utils.js';
import {config} from '../src/config.js';
import adapterManager, {uspDataHandler} from '../src/adapterManager.js';
import {timedAuctionHook} from '../src/utils/perfMetrics.js';
import {getHook} from '../src/hook.js';
import {enrichFPD} from '../src/fpd/enrichment.js';
import {cmpClient} from '../libraries/cmp/cmpClient.js';
import type {IABCMConfig, StaticCMConfig} from "../libraries/consentManagement/cmUtils.ts";
import type {CONSENT_USP} from "../src/consentHandler.ts";

const DEFAULT_CONSENT_API = 'iab';
const DEFAULT_CONSENT_TIMEOUT = 50;
const USPAPI_VERSION = 1;

export let consentAPI = DEFAULT_CONSENT_API;
export let consentTimeout = DEFAULT_CONSENT_TIMEOUT;
export let staticConsentData;

type USPConsentData = string;
type BaseUSPConfig = {
  /**
   * Length of time (in milliseconds) to delay auctions while waiting for consent data from the CMP.
   * Default is 50.
   */
  timeout?: number;
}

type StaticUSPData = {
  getUSPData: {
    uspString: USPConsentData;
  }
}
type USPCMConfig = BaseUSPConfig & (IABCMConfig | StaticCMConfig<StaticUSPData>);

declare module '../src/consentHandler' {
  interface ConsentData {
    [CONSENT_USP]: USPConsentData;
  }
  interface ConsentManagementConfig {
    [CONSENT_USP]?: USPCMConfig;
  }
}

let consentData;
let enabled = false;

// consent APIs
const uspCallMap = {
  'iab': lookupUspConsent,
  'static': lookupStaticConsentData
};

/**
 * This function reads the consent string from the config to obtain the consent information of the user.
 */
function lookupStaticConsentData({onSuccess, onError}) {
  processUspData(staticConsentData, {onSuccess, onError});
}

/**
 * This function handles interacting with an USP compliant consent manager to obtain the consent information of the user.
 * Given the async nature of the USP's API, we pass in acting success/error callback functions to exit this function
 * based on the appropriate result.
 */
function lookupUspConsent({onSuccess, onError}) {
  function handleUspApiResponseCallbacks() {
    const uspResponse = {} as any;

    function afterEach() {
      if (uspResponse.usPrivacy) {
        processUspData(uspResponse, {onSuccess, onError})
      } else {
        onError('Unable to get USP consent string.');
      }
    }

    return {
      consentDataCallback: (consentResponse, success) => {
        if (success && consentResponse.uspString) {
          uspResponse.usPrivacy = consentResponse.uspString;
        }
        afterEach();
      },
    };
  }

  const callbackHandler = handleUspApiResponseCallbacks();

  const cmp = cmpClient({
    apiName: '__uspapi',
    apiVersion: USPAPI_VERSION,
    apiArgs: ['command', 'version', 'callback'],
  }) as any;

  if (!cmp) {
    return onError('USP CMP not found.');
  }

  if (cmp.isDirect) {
    logInfo('Detected USP CMP is directly accessible, calling it now...');
  } else {
    logInfo(
      'Detected USP CMP is outside the current iframe where Prebid.js is located, calling it now...'
    );
  }

  cmp({
    command: 'getUSPData',
    callback: callbackHandler.consentDataCallback
  });

  cmp({
    command: 'registerDeletion',
    callback: (res, success) => (success == null || success) && adapterManager.callDataDeletionRequest(res)
  }).catch(e => {
    logError('Error invoking CMP `registerDeletion`:', e);
  });
}

/**
 * Lookup consent data and store it in the `consentData` global as well as `adapterManager.js`' uspDataHanlder.
 *
 * @param cb a callback that takes an error message and extra error arguments; all args will be undefined if consent
 * data was retrieved successfully.
 */
function loadConsentData(cb?) {
  let timer = null;
  let isDone = false;

  function done(consentData, errMsg, ...extraArgs) {
    if (timer != null) {
      clearTimeout(timer);
    }
    isDone = true;
    uspDataHandler.setConsentData(consentData);
    if (cb != null) {
      cb(errMsg, ...extraArgs)
    }
  }

  if (!uspCallMap[consentAPI]) {
    done(null, `USP framework (${consentAPI}) is not a supported framework. Aborting consentManagement module and resuming auction.`);
    return;
  }

  const callbacks = {
    onSuccess: done,
    onError: function (errMsg, ...extraArgs) {
      done(null, `${errMsg} Resuming auction without consent data as per consentManagement config.`, ...extraArgs);
    }
  }

  uspCallMap[consentAPI](callbacks);

  if (!isDone) {
    if (consentTimeout === 0) {
      processUspData(undefined, callbacks);
    } else {
      timer = setTimeout(callbacks.onError.bind(null, 'USPAPI workflow exceeded timeout threshold.'), consentTimeout)
    }
  }
}

/**
 * If consentManagementUSP module is enabled (ie included in setConfig), this hook function will attempt to fetch the
 * user's encoded consent string from the supported USPAPI. Once obtained, the module will store this
 * data as part of a uspConsent object which gets transferred to adapterManager's uspDataHandler object.
 * This information is later added into the bidRequest object for any supported adapters to read/pass along to their system.
 * @param {object} reqBidsConfigObj required; This is the same param that's used in pbjs.requestBids.
 * @param {function} fn required; The next function in the chain, used by hook.ts
 */
export const requestBidsHook = timedAuctionHook('usp', function requestBidsHook(fn, reqBidsConfigObj) {
  if (!enabled) {
    enableConsentManagement();
  }
  loadConsentData((errMsg, ...extraArgs) => {
    if (errMsg != null) {
      logWarn(errMsg, ...extraArgs);
    }
    fn.call(this, reqBidsConfigObj);
  });
});

/**
 * This function checks the consent data provided by USPAPI to ensure it's in an expected state.
 * If it's bad, we exit the module depending on config settings.
 * If it's good, then we store the value and exit the module.
 *
 * @param {Object} consentObject - The object returned by USPAPI that contains the user's consent choices.
 * @param {Object} callbacks - An object containing the callback functions.
 * @param {function(string): void} callbacks.onSuccess - Callback accepting the resolved USP consent string.
 * @param {function(string, ...Object?): void} callbacks.onError - Callback accepting an error message and any extra error arguments (used purely for logging).
 */
function processUspData(consentObject, {onSuccess, onError}) {
  const valid = !!(consentObject && consentObject.usPrivacy);
  if (!valid) {
    onError(`USPAPI returned unexpected value during lookup process.`, consentObject);
    return;
  }

  storeUspConsentData(consentObject);
  onSuccess(consentData);
}

/**
 * Stores USP data locally in module and then invokes uspDataHandler.setConsentData() to make information available in adaptermanger.js for later in the auction
 * @param {object} consentObject required; an object representing user's consent choices (can be undefined in certain use-cases for this function only)
 */
function storeUspConsentData(consentObject) {
  if (consentObject && consentObject.usPrivacy) {
    consentData = consentObject.usPrivacy;
  }
}

/**
 * Simply resets the module's consentData variable back to undefined, mainly for testing purposes
 */
export function resetConsentData() {
  consentData = undefined;
  consentAPI = undefined;
  consentTimeout = undefined;
  uspDataHandler.reset();
  enabled = false;
}

/**
 * A configuration function that initializes some module variables, as well as add a hook into the requestBids function
 * @param {object} config required; consentManagementUSP module config settings; usp (string), timeout (int)
 */
export function setConsentConfig(config) {
  config = config && config.usp;
  if (!config || typeof config !== 'object') {
    logWarn('consentManagement.usp config not defined, using defaults');
  }
  if (config && isStr(config.cmpApi)) {
    consentAPI = config.cmpApi;
  } else {
    consentAPI = DEFAULT_CONSENT_API;
    logInfo(`consentManagement.usp config did not specify cmpApi. Using system default setting (${DEFAULT_CONSENT_API}).`);
  }

  if (config && isNumber(config.timeout)) {
    consentTimeout = config.timeout;
  } else {
    consentTimeout = DEFAULT_CONSENT_TIMEOUT;
    logInfo(`consentManagement.usp config did not specify timeout. Using system default setting (${DEFAULT_CONSENT_TIMEOUT}).`);
  }
  if (consentAPI === 'static') {
    if (isPlainObject(config.consentData) && isPlainObject(config.consentData.getUSPData)) {
      if (config.consentData.getUSPData.uspString) staticConsentData = { usPrivacy: config.consentData.getUSPData.uspString };
      consentTimeout = 0;
    } else {
      logError(`consentManagement config with cmpApi: 'static' did not specify consentData. No consents will be available to adapters.`);
    }
  }
  enableConsentManagement(true);
}

function enableConsentManagement(configFromUser = false) {
  if (!enabled) {
    logInfo(`USPAPI consentManagement module has been activated${configFromUser ? '' : ` using default values (api: '${consentAPI}', timeout: ${consentTimeout}ms)`}`);
    enabled = true;
    uspDataHandler.enable();
  }
  loadConsentData(); // immediately look up consent data to make it available without requiring an auction
}
config.getConfig('consentManagement', config => setConsentConfig(config.consentManagement));

getHook('requestBids').before(requestBidsHook, 50);

export function enrichFPDHook(next, fpd) {
  return next(fpd.then(ortb2 => {
    const consent = uspDataHandler.getConsentData();
    if (consent) {
      deepSetValue(ortb2, 'regs.ext.us_privacy', consent)
    }
    return ortb2;
  }))
}

enrichFPD.before(enrichFPDHook);
