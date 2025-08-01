/**
 * This module adds [GAM support]{@link https://www.doubleclickbygoogle.com/} for Video to Prebid.
 */

import { getSignals } from '../libraries/gptUtils/gptUtils.js';
import { registerVideoSupport } from '../src/adServerManager.js';
import { getPPID } from '../src/adserver.js';
import { auctionManager } from '../src/auctionManager.js';
import { config } from '../src/config.js';
import { EVENTS } from '../src/constants.js';
import * as events from '../src/events.js';
import { getHook } from '../src/hook.js';
import { getRefererInfo } from '../src/refererDetection.js';
import { targeting } from '../src/targeting.js';
import {
  buildUrl,
  formatQS,
  isEmpty,
  isNumber,
  logError,
  logWarn,
  parseSizesInput,
  parseUrl
} from '../src/utils.js';
import {DEFAULT_GAM_PARAMS, GAM_ENDPOINT, gdprParams} from '../libraries/gamUtils/gamUtils.js';
import { vastLocalCache } from '../src/videoCache.js';
import { fetch } from '../src/ajax.js';
import XMLUtil from '../libraries/xmlUtils/xmlUtils.js';

import {getGlobalVarName} from '../src/buildOptions.js';
/**
 * @typedef {Object} DfpVideoParams
 *
 * This object contains the params needed to form a URL which hits the
 * [DFP API]{@link https://support.google.com/dfp_premium/answer/1068325?hl=en}.
 *
 * All params (except iu, mentioned below) should be considered optional. This module will choose reasonable
 * defaults for all of the other required params.
 *
 * The cust_params property, if present, must be an object. It will be merged with the rest of the
 * standard Prebid targeting params (hb_adid, hb_bidder, etc).
 *
 * @param {string} iu This param *must* be included, in order for us to create a valid request.
 * @param [string] description_url This field is required if you want Ad Exchange to bid on our ad unit...
 *   but otherwise optional
 */

/**
 * @typedef {Object} DfpVideoOptions
 *
 * @param {Object} adUnit The adUnit which this bid is supposed to help fill.
 * @param [Object] bid The bid which should be considered alongside the rest of the adserver's demand.
 *   If this isn't defined, then we'll use the winning bid for the adUnit.
 *
 * @param {DfpVideoParams} [params] Query params which should be set on the DFP request.
 *   These will override this module's defaults whenever they conflict.
 * @param {string} [url] video adserver url
 */

export const dep = {
  ri: getRefererInfo
}

export const VAST_TAG_URI_TAGNAME = 'VASTAdTagURI';

/**
 * Merge all the bid data and publisher-supplied options into a single URL, and then return it.
 *
 * @see [The DFP API]{@link https://support.google.com/dfp_premium/answer/1068325?hl=en#env} for details.
 *
 * @param {DfpVideoOptions} options Options which should be used to construct the URL.
 *
 * @return {string} A URL which calls DFP, letting options.bid
 *   (or the auction's winning bid for this adUnit, if undefined) compete alongside the rest of the
 *   demand in DFP.
 */
export function buildGamVideoUrl(options) {
  if (!options.params && !options.url) {
    logError(`A params object or a url is required to use ${getGlobalVarName()}.adServers.gam.buildVideoUrl`);
    return;
  }

  const adUnit = options.adUnit;
  const bid = options.bid || targeting.getWinningBids(adUnit.code)[0];

  let urlComponents = {};

  if (options.url) {
    // when both `url` and `params` are given, parsed url will be overwriten
    // with any matching param components
    urlComponents = parseUrl(options.url, {noDecodeWholeURL: true});

    if (isEmpty(options.params)) {
      return buildUrlFromAdserverUrlComponents(urlComponents, bid, options);
    }
  }

  const derivedParams = {
    correlator: Date.now(),
    sz: parseSizesInput(adUnit?.mediaTypes?.video?.playerSize).join('|'),
    url: encodeURIComponent(location.href),
  };

  const urlSearchComponent = urlComponents.search;
  const urlSzParam = urlSearchComponent && urlSearchComponent.sz;
  if (urlSzParam) {
    derivedParams.sz = urlSzParam + '|' + derivedParams.sz;
  }

  const encodedCustomParams = getCustParams(bid, options, urlSearchComponent && urlSearchComponent.cust_params);

  const queryParams = Object.assign({},
    DEFAULT_GAM_PARAMS,
    urlComponents.search,
    derivedParams,
    options.params,
    { cust_params: encodedCustomParams },
    gdprParams()
  );

  const descriptionUrl = getDescriptionUrl(bid, options, 'params');
  if (descriptionUrl) { queryParams.description_url = descriptionUrl; }

  if (!queryParams.ppid) {
    const ppid = getPPID();
    if (ppid != null) {
      queryParams.ppid = ppid;
    }
  }

  const video = options.adUnit?.mediaTypes?.video;
  Object.entries({
    plcmt: () => video?.plcmt,
    min_ad_duration: () => isNumber(video?.minduration) ? video.minduration * 1000 : null,
    max_ad_duration: () => isNumber(video?.maxduration) ? video.maxduration * 1000 : null,
    vpos() {
      const startdelay = video?.startdelay;
      if (isNumber(startdelay)) {
        if (startdelay === -2) return 'postroll';
        if (startdelay === -1 || startdelay > 0) return 'midroll';
        return 'preroll';
      }
    },
    vconp: () => Array.isArray(video?.playbackmethod) && video.playbackmethod.some(m => m === 7) ? '2' : undefined,
    vpa() {
      // playbackmethod = 3 is play on click; 1, 2, 4, 5, 6 are autoplay
      if (Array.isArray(video?.playbackmethod)) {
        const click = video.playbackmethod.some(m => m === 3);
        const auto = video.playbackmethod.some(m => [1, 2, 4, 5, 6].includes(m));
        if (click && !auto) return 'click';
        if (auto && !click) return 'auto';
      }
    },
    vpmute() {
      // playbackmethod = 2, 6 are muted; 1, 3, 4, 5 are not
      if (Array.isArray(video?.playbackmethod)) {
        const muted = video.playbackmethod.some(m => [2, 6].includes(m));
        const talkie = video.playbackmethod.some(m => [1, 3, 4, 5].includes(m));
        if (muted && !talkie) return '1';
        if (talkie && !muted) return '0';
      }
    }
  }).forEach(([param, getter]) => {
    if (!queryParams.hasOwnProperty(param)) {
      const val = getter();
      if (val != null) {
        queryParams[param] = val;
      }
    }
  });
  const fpd = auctionManager.index.getBidRequest(options.bid || {})?.ortb2 ??
    auctionManager.index.getAuction(options.bid || {})?.getFPD()?.global;

  const signals = getSignals(fpd);

  if (signals.length) {
    queryParams.ppsj = btoa(JSON.stringify({
      PublisherProvidedTaxonomySignals: signals
    }))
  }

  return buildUrl(Object.assign({}, GAM_ENDPOINT, urlComponents, { search: queryParams }));
}

export function notifyTranslationModule(fn) {
  fn.call(this, 'dfp');
}

if (config.getConfig('brandCategoryTranslation.translationFile')) { getHook('registerAdserver').before(notifyTranslationModule); }

/**
 * Builds a video url from a base dfp video url and a winning bid, appending
 * Prebid-specific key-values.
 * @param {Object} components base video adserver url parsed into components object
 * @param {Object} bid winning bid object to append parameters from
 * @param {Object} options Options which should be used to construct the URL (used for custom params).
 * @return {string} video url
 */
function buildUrlFromAdserverUrlComponents(components, bid, options) {
  const descriptionUrl = getDescriptionUrl(bid, components, 'search');
  if (descriptionUrl) {
    components.search.description_url = descriptionUrl;
  }

  components.search.cust_params = getCustParams(bid, options, components.search.cust_params);
  return buildUrl(components);
}

/**
 * Returns the encoded vast url if it exists on a bid object, only if prebid-cache
 * is disabled, and description_url is not already set on a given input
 * @param {Object} bid object to check for vast url
 * @param {Object} components the object to check that description_url is NOT set on
 * @param {string} prop the property of components that would contain description_url
 * @return {string | undefined} The encoded vast url if it exists, or undefined
 */
function getDescriptionUrl(bid, components, prop) {
  return components?.[prop]?.description_url || encodeURIComponent(dep.ri().page);
}

/**
 * Returns the encoded `cust_params` from the bid.adserverTargeting and adds the `hb_uuid`, and `hb_cache_id`. Optionally the options.params.cust_params
 * @param {Object} bid
 * @param {Object} options this is the options passed in from the `buildGamVideoUrl` function
 * @return {Object} Encoded key value pairs for cust_params
 */
function getCustParams(bid, options, urlCustParams) {
  const adserverTargeting = (bid && bid.adserverTargeting) || {};

  let allTargetingData = {};
  const adUnit = options && options.adUnit;
  if (adUnit) {
    const allTargeting = targeting.getAllTargeting(adUnit.code);
    allTargetingData = (allTargeting) ? allTargeting[adUnit.code] : {};
  }

  const prebidTargetingSet = Object.assign({},
    // Why are we adding standard keys here ? Refer https://github.com/prebid/Prebid.js/issues/3664
    { hb_uuid: bid && bid.videoCacheKey },
    // hb_cache_id became optional in prebid 5.0 after 4.x enabled the concept of optional keys. Discussion led to reversing the prior expectation of deprecating hb_uuid
    { hb_cache_id: bid && bid.videoCacheKey },
    allTargetingData,
    adserverTargeting,
  );

  // TODO: WTF is this? just firing random events, guessing at the argument, hoping noone notices?
  events.emit(EVENTS.SET_TARGETING, {[adUnit.code]: prebidTargetingSet});

  // merge the prebid + publisher targeting sets
  const publisherTargetingSet = options?.params?.cust_params;
  const targetingSet = Object.assign({}, prebidTargetingSet, publisherTargetingSet);
  let encodedParams = encodeURIComponent(formatQS(targetingSet));
  if (urlCustParams) {
    encodedParams = urlCustParams + '%26' + encodedParams;
  }

  return encodedParams;
}

async function getVastForLocallyCachedBids(gamVastWrapper, localCacheMap) {
  try {
    const xmlUtil = XMLUtil();
    const xmlDoc = xmlUtil.parse(gamVastWrapper);
    const vastAdTagUriElement = xmlDoc.querySelectorAll(VAST_TAG_URI_TAGNAME)[0];

    if (!vastAdTagUriElement || !vastAdTagUriElement.textContent) {
      return gamVastWrapper;
    }

    const uuidExp = new RegExp(`[A-Fa-f0-9]{8}-(?:[A-Fa-f0-9]{4}-){3}[A-Fa-f0-9]{12}`, 'gi');
    const matchResult = Array.from(vastAdTagUriElement.textContent.matchAll(uuidExp));
    const uuidCandidates = matchResult
      .map(([uuid]) => uuid)
      .filter(uuid => localCacheMap.has(uuid));

    if (uuidCandidates.length != 1) {
      logWarn(`Unable to determine unique uuid in ${VAST_TAG_URI_TAGNAME}`);
      return gamVastWrapper;
    }
    const uuid = uuidCandidates[0];

    const blobUrl = localCacheMap.get(uuid);
    const base64BlobContent = await getBase64BlobContent(blobUrl);
    const cdata = xmlDoc.createCDATASection(base64BlobContent);
    vastAdTagUriElement.textContent = '';
    vastAdTagUriElement.appendChild(cdata);
    return xmlUtil.serialize(xmlDoc);
  } catch (error) {
    logWarn('Unable to process xml', error);
    return gamVastWrapper;
  }
};

export async function getVastXml(options, localCacheMap = vastLocalCache) {
  const vastUrl = buildGamVideoUrl(options);
  const response = await fetch(vastUrl);
  if (!response.ok) {
    throw new Error('Unable to fetch GAM VAST wrapper');
  }

  const gamVastWrapper = await response.text();

  if (config.getConfig('cache.useLocal')) {
    const vastXml = await getVastForLocallyCachedBids(gamVastWrapper, localCacheMap);
    return vastXml;
  }

  return gamVastWrapper;
}

export async function getBase64BlobContent(blobUrl) {
  const response = await fetch(blobUrl);
  if (!response.ok) {
    logError('Unable to fetch blob');
    throw new Error('Blob not found');
  }
  // Mechanism to handle cases where VAST tags are fetched
  // from a context where the blob resource is not accessible.
  // like IMA SDK iframe
  const blobContent = await response.text();
  const dataUrl = `data://text/xml;base64,${btoa(blobContent)}`;
  return dataUrl;
}

export { buildGamVideoUrl as buildDfpVideoUrl };

registerVideoSupport('gam', {
  buildVideoUrl: buildGamVideoUrl,
  getVastXml
});
