/**
 * This module adds humansecurityMalvDefense provider to the real time data module
 * The {@link module:modules/realTimeData} module is required
 * The module will wrap bid responses markup in humansecurityMalvDefense agent script for protection
 * @module modules/humansecurityMalvDefenseRtdProvider
 * @requires module:modules/realTimeData
 */

import { submodule } from '../src/hook.js';
import { loadExternalScript } from '../src/adloader.js';
import { logError, generateUUID, insertElement } from '../src/utils.js';
import * as events from '../src/events.js';
import { EVENTS } from '../src/constants.js';
import { MODULE_TYPE_RTD } from '../src/activities/modules.js';

/**
 * @typedef {import('../modules/rtdModule/index.js').RtdSubmodule} RtdSubmodule
 */

/**
 * Custom error class to differentiate validation errors
 */
class ConfigError extends Error { }

/**
 * Bid processing step which alters the ad HTML to contain bid-specific information, which can be used to identify the creative later.
 * @param {Object} bidResponse Bid response data
 */
function bidWrapStepAugmentHtml(bidResponse) {
  bidResponse.ad = `<!-- pbad://creativeId=${bidResponse.creativeId || ''}&bidderCode=${bidResponse.bidderCode || ''}&cpm=${bidResponse.cpm || ''} -->\n${bidResponse.ad}`;
}

/**
 * Page initialization step which adds the protector script to the whole page. With that, there is no need wrapping bids, and the coverage is better.
 * @param {string} scriptURL The script URL to add to the page for protection
 * @param {string} moduleName
 */
function pageInitStepProtectPage(scriptURL, moduleName) {
  loadExternalScript(scriptURL, MODULE_TYPE_RTD, moduleName);
}

/**
 * Factory function that creates, registers, and returns a new RTD submodule instance.
 * This is the single entry point for this module's logic.
 * @param {string} moduleName - The name of the module
 * @returns {Object} An object containing the module's internal functions for testing
 */
export function createRtdSubmodule(moduleName) {
  // ============================ MODULE STATE ===============================

  /**
   * @type {function(): void}
   * Page-wide initialization step / strategy
   */
  let onModuleInit = () => {};

  /**
   * @type {function(Object): void}
   * Bid response mutation step / strategy.
   */
  let onBidResponse = () => {};

  /**
   * @type {number}
   * 0 for unknown, 1 for preloaded, -1 for error.
   */
  let preloadStatus = 0;

  /**
   * The function to be called upon module init
   * Defined as a variable to be able to reset it naturally
   */
  let startBillableEvents = function() {
    // Upon this submodule initialization, every winner bid is considered to be protected
    // and therefore, subjected to billing
    events.on(EVENTS.BID_WON, winnerBidResponse => {
      events.emit(EVENTS.BILLABLE_EVENT, {
        vendor: moduleName,
        billingId: generateUUID(),
        type: 'impression',
        auctionId: winnerBidResponse.auctionId,
        transactionId: winnerBidResponse.transactionId,
        bidId: winnerBidResponse.requestId,
      });
    });
  }

  // ============================ MODULE LOGIC ===============================

  /**
   * Page initialization step which just preloads the script, to be available whenever we start processing the bids.
   * @param {string} scriptURL The script URL to preload
   */
  function pageInitStepPreloadScript(scriptURL) {
    // TODO: this bypasses adLoader
    const linkElement = document.createElement('link');
    linkElement.rel = 'preload';
    linkElement.as = 'script';
    linkElement.href = scriptURL;
    linkElement.onload = () => { preloadStatus = 1; };
    linkElement.onerror = () => { preloadStatus = -1; };
    insertElement(linkElement);
  }

  /**
   * Bid processing step which applies creative protection by wrapping the ad HTML.
   * @param {string} scriptURL
   * @param {number} requiredPreload
   * @param {Object} bidResponse
   */
  function bidWrapStepProtectByWrapping(scriptURL, requiredPreload, bidResponse) {
    // Still prepend bid info, it's always helpful to have creative data in its payload
    bidWrapStepAugmentHtml(bidResponse);

    // If preloading failed, or if configuration requires us to finish preloading -
    // we should not process this bid any further
    if (preloadStatus < requiredPreload) {
      return;
    }

    const sid = generateUUID();
    bidResponse.ad = `
    <script type="text/javascript"
      src="${scriptURL}"
      data-api-integration-mode="prebid"
      data-api-session-uuid="${sid}">
    </script>
    <script type="text/javascript">
      var ad = "${encodeURIComponent(bidResponse.ad)}";
      var agent = window["${sid}"];
      if (agent && typeof agent.put === "function") {
        agent.put(ad);
      }
      else {
        document.open();
        document.write(decodeURIComponent(ad));
        document.close();
      }
    </script>
  `;
  }

  /**
   * The function to be called upon module init. Depending on the passed config, initializes properly init/bid steps or throws ConfigError.
   * @param {Object} config
   */
  function readConfig(config) {
    if (!config.params) {
      throw new ConfigError(`Missing config parameters for ${moduleName} RTD module provider.`);
    }

    if (typeof config.params.cdnUrl !== 'string' || !/^https?:\/\//.test(config.params.cdnUrl)) {
      throw new ConfigError('Parameter "cdnUrl" is a required string parameter, which should start with "http(s)://".');
    }

    if (typeof config.params.protectionMode !== 'string') {
      throw new ConfigError('Parameter "protectionMode" is a required string parameter.');
    }

    const scriptURL = config.params.cdnUrl;

    switch (config.params.protectionMode) {
      case 'full':
        onModuleInit = () => pageInitStepProtectPage(scriptURL, moduleName);
        onBidResponse = (bidResponse) => bidWrapStepAugmentHtml(bidResponse);
        break;

      case 'bids':
        onModuleInit = () => pageInitStepPreloadScript(scriptURL);
        onBidResponse = (bidResponse) => bidWrapStepProtectByWrapping(scriptURL, 0, bidResponse);
        break;

      case 'bids-nowait':
        onModuleInit = () => pageInitStepPreloadScript(scriptURL);
        onBidResponse = (bidResponse) => bidWrapStepProtectByWrapping(scriptURL, 1, bidResponse);
        break;

      default:
        throw new ConfigError('Parameter "protectionMode" must be one of "full" | "bids" | "bids-nowait".');
    }
  }

  // ============================ MODULE REGISTRATION ===============================

  /**
   * The function which performs submodule registration.
   */
  function beforeInit() {
    submodule('realTimeData', /** @type {RtdSubmodule} */ ({
      name: moduleName,

      init: (config, userConsent) => {
        try {
          readConfig(config);
          onModuleInit();

          // Subscribing once to ensure no duplicate events
          // in case module initialization code runs multiple times
          // This should have been a part of submodule definition, but well...
          // The assumption here is that in production init() will be called exactly once
          startBillableEvents();
          startBillableEvents = () => {};
          return true;
        } catch (err) {
          if (err instanceof ConfigError) {
            logError(err.message);
          }
          return false;
        }
      },

      onBidResponseEvent: (bidResponse, config, userConsent) => {
        onBidResponse(bidResponse);
      }
    }));
  }

  return {
    readConfig,
    ConfigError,
    pageInitStepPreloadScript,
    pageInitStepProtectPage,
    bidWrapStepAugmentHtml,
    bidWrapStepProtectByWrapping,
    beforeInit
  };
}

const internals = createRtdSubmodule('humansecurityMalvDefense');

/**
 * Exporting encapsulated to this module functions
 * for testing purposes
 */
export const __TEST__ = internals;

internals.beforeInit();
