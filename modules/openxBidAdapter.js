import {config} from '../src/config.js';
import {registerBidder} from '../src/adapters/bidderFactory.js';
import * as utils from '../src/utils.js';
import {mergeDeep} from '../src/utils.js';
import {BANNER, NATIVE, VIDEO} from '../src/mediaTypes.js';
import {ortbConverter} from '../libraries/ortbConverter/converter.js';

const bidderConfig = 'hb_pb_ortb';
const bidderVersion = '2.0';
export const REQUEST_URL = 'https://rtb.openx.net/openrtbb/prebidjs';
export const SYNC_URL = 'https://u.openx.net/w/1.0/pd';
export const DEFAULT_PH = '2d1251ae-7f3a-47cf-bd2a-2f288854a0ba';
export const spec = {
  code: 'openx',
  gvlid: 69,
  supportedMediaTypes: [BANNER, VIDEO, NATIVE],
  isBidRequestValid,
  buildRequests,
  interpretResponse,
  getUserSyncs
};

registerBidder(spec);

const converter = ortbConverter({
  context: {
    netRevenue: true,
    ttl: 300,
    nativeRequest: {
      eventtrackers: [
        {event: 1, methods: [1, 2]},
      ]
    }
  },
  imp(buildImp, bidRequest, context) {
    const imp = buildImp(bidRequest, context);
    mergeDeep(imp, {
      tagid: bidRequest.params.unit,
      ext: {
        divid: bidRequest.adUnitCode
      }
    });
    if (bidRequest.params.customParams) {
      utils.deepSetValue(imp, 'ext.customParams', bidRequest.params.customParams);
    }
    if (bidRequest.params.customFloor && !imp.bidfloor) {
      imp.bidfloor = bidRequest.params.customFloor;
    }
    return imp;
  },
  request(buildRequest, imps, bidderRequest, context) {
    const req = buildRequest(imps, bidderRequest, context);
    mergeDeep(req, {
      at: 1,
      ext: {
        bc: `${bidderConfig}_${bidderVersion}`,
        pv: '$prebid.version$'
      }
    })
    const bid = context.bidRequests[0];
    if (bid.params.coppa) {
      utils.deepSetValue(req, 'regs.coppa', 1);
    }
    if (bid.params.doNotTrack) {
      utils.deepSetValue(req, 'device.dnt', 1);
    }
    if (bid.params.platform) {
      utils.deepSetValue(req, 'ext.platform', bid.params.platform);
    }
    if (bid.params.delDomain) {
      utils.deepSetValue(req, 'ext.delDomain', bid.params.delDomain);
    }
    if (bid.params.response_template_name) {
      utils.deepSetValue(req, 'ext.response_template_name', bid.params.response_template_name);
    }
    if (bid.params.test) {
      req.test = 1
    }
    return req;
  },
  bidResponse(buildBidResponse, bid, context) {
    const bidResponse = buildBidResponse(bid, context);
    if (bid.ext) {
      bidResponse.meta.networkId = bid.ext.dsp_id;
      bidResponse.meta.advertiserId = bid.ext.buyer_id;
      bidResponse.meta.brandId = bid.ext.brand_id;
    }
    return bidResponse;
  },
  response(buildResponse, bidResponses, ortbResponse, context) {
    // pass these from request to the responses for use in userSync
    const {ortbRequest} = context;
    if (ortbRequest.ext) {
      if (ortbRequest.ext.delDomain) {
        utils.deepSetValue(ortbResponse, 'ext.delDomain', ortbRequest.ext.delDomain);
      }
      if (ortbRequest.ext.platform) {
        utils.deepSetValue(ortbResponse, 'ext.platform', ortbRequest.ext.platform);
      }
    }
    const response = buildResponse(bidResponses, ortbResponse, context);
    // TODO: we may want to standardize this and move fledge logic to ortbConverter
    let fledgeAuctionConfigs = utils.deepAccess(ortbResponse, 'ext.fledge_auction_configs');
    if (fledgeAuctionConfigs) {
      fledgeAuctionConfigs = Object.entries(fledgeAuctionConfigs).map(([bidId, cfg]) => {
        return {
          bidId,
          config: mergeDeep(Object.assign({}, cfg), {
            auctionSignals: {
              ortb2Imp: context.impContext[bidId]?.imp,
            },
          }),
        }
      });
      return {
        bids: response.bids,
        paapi: fledgeAuctionConfigs,
      }
    } else {
      return response
    }
  },
  overrides: {
    imp: {
      bidfloor(setBidFloor, imp, bidRequest, context) {
        // enforce floors should always be in USD
        // TODO: does it make sense that request.cur can be any currency, but request.imp[].bidfloorcur must be USD?
        const floor = {};
        setBidFloor(floor, bidRequest, {...context, currency: 'USD'});
        if (floor.bidfloorcur === 'USD') {
          Object.assign(imp, floor);
        }
      },
      video(orig, imp, bidRequest, context) {
        if (FEATURES.VIDEO) {
          // `orig` is the video imp processor, which looks at bidRequest.mediaTypes[VIDEO]
          // to populate imp.video
          // alter its input `bidRequest` to also pick up parameters from `bidRequest.params`
          let videoParams = bidRequest.mediaTypes[VIDEO];
          if (videoParams) {
            videoParams = Object.assign({}, videoParams, bidRequest.params.video);
            bidRequest = {...bidRequest, mediaTypes: {[VIDEO]: videoParams}}
          }
          orig(imp, bidRequest, context);
        }
      }
    }
  }
});

function isBidRequestValid(bidRequest) {
  const hasDelDomainOrPlatform = bidRequest.params.delDomain ||
    bidRequest.params.platform;

  if (utils.deepAccess(bidRequest, 'mediaTypes.banner') &&
    hasDelDomainOrPlatform) {
    return !!bidRequest.params.unit ||
      utils.deepAccess(bidRequest, 'mediaTypes.banner.sizes.length') > 0;
  }

  return !!(bidRequest.params.unit && hasDelDomainOrPlatform);
}

function buildRequests(bidRequests, bidderRequest) {
  const videoRequests = bidRequests.filter(bidRequest => isVideoBidRequest(bidRequest));
  const bannerAndNativeRequests = bidRequests.filter(bidRequest => isBannerBidRequest(bidRequest) || isNativeBidRequest(bidRequest))
    // In case of multi-format bids remove `video` from mediaTypes as for video a separate bid request is built
    .map(bid => ({...bid, mediaTypes: {...bid.mediaTypes, video: undefined}}));

  const requests = bannerAndNativeRequests.length ? [createRequest(bannerAndNativeRequests, bidderRequest, null)] : [];
  videoRequests.forEach(bid => {
    requests.push(createRequest([bid], bidderRequest, VIDEO));
  });
  return requests;
}

function createRequest(bidRequests, bidderRequest, mediaType) {
  return {
    method: 'POST',
    url: config.getConfig('openxOrtbUrl') || REQUEST_URL,
    data: converter.toORTB({bidRequests, bidderRequest, context: {mediaType}})
  }
}

function isVideoBidRequest(bidRequest) {
  return utils.deepAccess(bidRequest, 'mediaTypes.video');
}

function isNativeBidRequest(bidRequest) {
  return utils.deepAccess(bidRequest, 'mediaTypes.native');
}

function isBannerBidRequest(bidRequest) {
  const isNotVideoOrNativeBid = !isVideoBidRequest(bidRequest) && !isNativeBidRequest(bidRequest)
  return utils.deepAccess(bidRequest, 'mediaTypes.banner') || isNotVideoOrNativeBid;
}

function interpretResponse(resp, req) {
  if (!resp.body) {
    resp.body = {nbr: 0};
  }
  return converter.fromORTB({request: req.data, response: resp.body});
}

/**
 * @param syncOptions
 * @param responses
 * @param gdprConsent
 * @param uspConsent
 * @param gppConsent
 * @return {{type: (string), url: (*|string)}[]}
 */
function getUserSyncs(syncOptions, responses, gdprConsent, uspConsent, gppConsent) {
  if (syncOptions.iframeEnabled || syncOptions.pixelEnabled) {
    const pixelType = syncOptions.iframeEnabled ? 'iframe' : 'image';
    const queryParamStrings = [];
    let syncUrl = SYNC_URL;
    if (gdprConsent) {
      queryParamStrings.push('gdpr=' + (gdprConsent.gdprApplies ? 1 : 0));
      queryParamStrings.push('gdpr_consent=' + encodeURIComponent(gdprConsent.consentString || ''));
    }
    if (uspConsent) {
      queryParamStrings.push('us_privacy=' + encodeURIComponent(uspConsent));
    }
    if (gppConsent?.gppString && gppConsent?.applicableSections?.length) {
      queryParamStrings.push('gpp=' + encodeURIComponent(gppConsent.gppString));
      queryParamStrings.push('gpp_sid=' + gppConsent.applicableSections.join(','));
    }
    if (responses.length > 0 && responses[0].body && responses[0].body.ext) {
      const ext = responses[0].body.ext;
      if (ext.delDomain) {
        syncUrl = `https://${ext.delDomain}/w/1.0/pd`
      } else if (ext.platform) {
        queryParamStrings.push('ph=' + ext.platform)
      }
    } else {
      queryParamStrings.push('ph=' + DEFAULT_PH)
    }
    return [{
      type: pixelType,
      url: `${syncUrl}${queryParamStrings.length > 0 ? '?' + queryParamStrings.join('&') : ''}`
    }];
  }
}
