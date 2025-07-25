import {getBidIdParameter, getValue} from '../src/utils.js';
import {registerBidder} from '../src/adapters/bidderFactory.js';
const BIDDER_CODE = 'videoreach';
const ENDPOINT_URL = 'https://a.videoreach.com/hb/';

export const spec = {
  code: BIDDER_CODE,
  supportedMediaTypes: ['banner'],

  isBidRequestValid: function(bid) {
    return !!(bid.params.TagId);
  },

  buildRequests: function(validBidRequests, bidderRequest) {
    const data = {
      data: validBidRequests.map(function(bid) {
        return {
          TagId: getValue(bid.params, 'TagId'),
          adUnitCode: getBidIdParameter('adUnitCode', bid),
          bidId: getBidIdParameter('bidId', bid),
          bidderRequestId: getBidIdParameter('bidderRequestId', bid),
          // TODO: fix auctionId leak: https://github.com/prebid/Prebid.js/issues/9781
          auctionId: getBidIdParameter('auctionId', bid),
          transactionId: bid.ortb2Imp?.ext?.tid,
        }
      })
    };

    if (bidderRequest && bidderRequest.refererInfo) {
      // TODO: is 'page' the right value here?
      data.referrer = bidderRequest.refererInfo.page;
    }

    if (bidderRequest && bidderRequest.gdprConsent) {
      data.gdpr = {
        consent_string: bidderRequest.gdprConsent.consentString,
        consent_required: bidderRequest.gdprConsent.gdprApplies
      };
    }

    return {
      method: 'POST',
      url: ENDPOINT_URL,
      data: JSON.stringify(data)
    };
  },

  interpretResponse: function(serverResponse) {
    const bidResponses = [];
    serverResponse = serverResponse.body;

    if (serverResponse.responses) {
      serverResponse.responses.forEach(function (bid) {
        const bidResponse = {
          cpm: bid.cpm,
          width: bid.width,
          height: bid.height,
          currency: bid.currency,
          netRevenue: true,
          ttl: bid.ttl,
          ad: bid.ad,
          requestId: bid.bidId,
          creativeId: bid.creativeId,
          meta: {
            advertiserDomains: bid && bid.adomain ? bid.adomain : []
          }
        };
        bidResponses.push(bidResponse);
      });
    }
    return bidResponses;
  },

  getUserSyncs: function(syncOptions, responses, gdprConsent) {
    const syncs = [];

    if (responses.length && responses[0].body.responses.length) {
      let params = '';
      var gdpr;

      if (gdprConsent && typeof gdprConsent.consentString === 'string') {
        if (typeof gdprConsent.gdprApplies === 'boolean') {
          params += 'gdpr=' + gdprConsent.gdprApplies + '&gdpr_consent=' + gdprConsent.consentString;
        } else {
          params += 'gdpr_consent=' + gdprConsent.consentString;
        }
      }

      if (syncOptions.pixelEnabled) {
        const SyncPixels = responses[0].body.responses[0].sync;

        if (SyncPixels) {
          SyncPixels.forEach(sync => {
            gdpr = (params) ? ((sync.split('?')[1] ? '&' : '?') + params) : '';

            syncs.push({
              type: 'image',
              url: sync + gdpr
            });
          });
        }
      }

      if (syncOptions.iframeEnabled) {
        const SyncFrame = responses[0].body.responses[0].syncframe;

        if (SyncFrame) {
          SyncFrame.forEach(sync => {
            gdpr = (params) ? ((sync.split('?')[1] ? '&' : '?') + params) : '';

            syncs.push({
              type: 'iframe',
              url: sync + gdpr
            });
          });
        }
      }
    }

    return syncs;
  }
};

registerBidder(spec);
