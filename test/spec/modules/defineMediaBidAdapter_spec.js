// jshint esversion: 6, es3: false, node: true
import {assert, expect} from 'chai';
import {getStorageManager} from 'src/storageManager.js';
import {spec} from 'modules/defineMediaBidAdapter.js';
import { deepClone } from 'src/utils.js';

const BIDDER_CODE = 'defineMedia';

describe('Define Media Bid Adapter', function () {
  const auctionId = 'b06c5141-fe8f-4cdf-9d7d-54415490a917';
  const bidderRequestId = "15246a574e859f";
  const auctionStart = new Date().getTime();
  const mediaTypes = ['banner'];

  const mockValidBids = [
    {
      adUnitCode: "test-div",
      auctionId: auctionId,
      bidId: "aacf1ab7fb6c3e",
      bidder: BIDDER_CODE,
      bidderRequestId: bidderRequestId,
      bidRequestsCount: 1,
      bidderRequestsCount: 1,
      auctionsCount: 1,
      bidderWinsCount: 0,
      mediaTypes: {banner: {
        sizes: [[350, 200]],
      }},
      params:{
        'supplierDomainName': 'definemedia.de',
        'devMode': true
      },
      src: "client",
      transactionId: "54a58774-7a41-494e-9aaf-fa7b79164f0c"
    }
  ];

  const mockBidderRequest = {
    auctionId: auctionId,
    auctionStart: auctionStart,
    bidderCode: BIDDER_CODE,
    bidderRequestId: bidderRequestId,
    bids: mockValidBids,
    gdprConsent: {consentString: "BOtmiBKOtmiBKABABAENAFAAAAACeAAA", gdprApplies: true},
    //    ortb2: {...},
    refererInfo: {
      canonicalUrl: null,
      page: "http://mypage.org?pbjs_debug=true",
      domain: "mypage.org",
      referer: null,
      numIframes: 0,
      reachedTop: true,
      isAmp: false,
      stack: ["http://mypage.org?pbjs_debug=true"]
    }
  }

  describe('isBidRequestValid', function () {
    it('should return true when required params found', function () {
      for (const bidRequest of mockValidBids) {
        assert.isTrue(spec.isBidRequestValid(bidRequest));
      }
    });

    it('should return false when supplierDomainName is not set', function () {
      let invalidBids = deepClone(mockValidBids);
      for (const bidRequest of invalidBids) {
        bidRequest.params = {};
        assert.isFalse(spec.isBidRequestValid(bidRequest));
      }
    });
  });

  describe('buildRequests', function () {
    beforeEach(function () {
      sinon.useFakeXMLHttpRequest();
      // Add logic to capture and inspect XHR requests
    });

    it('should send request with correct structure', function () {
      let requests = spec.buildRequests(mockValidBids, mockBidderRequest);

      for (const request of requests) {
        assert.equal(request.method, 'POST');
        assert.ok(request.data);
      }
    });

    it('should have default request structure', function () {
      let keys = 'id,imp,source'.split(',');
      let requests = spec.buildRequests(mockValidBids, mockBidderRequest);

      for (const request of requests) {
        let data = Object.keys(request.data);
        assert.includeDeepMembers(data, keys);
      }
    });

    it('Verify the site url', function () {
      let siteUrl = 'https://www.yourdomain.tld/your-directory/';
      let bidderRequest = deepClone(mockBidderRequest);

      bidderRequest.refererInfo.page = siteUrl;

      console.log(JSON.stringify(bidderRequest, null, 2));

      let requests = spec.buildRequests(mockValidBids, bidderRequest);

      for (const request of requests) {
        console.log(JSON.stringify(request.data, null, 2));
        assert.equal(request.data.site.page, siteUrl);
      }
    });
  });
});

/*describe('interpretResponse', function () {
  const goodBannerResponse = {
    body: {
      cur: 'EUR',
      id: 'bidid1',
      seatbid: [
        {
          seat: 'seedingAlliance',
          bid: [{
            adm: '<iframe src="https://domain.tld/cds/delivery?wp=0.90"></iframe>',
            impid: 1,
            price: 0.90,
            h: 250,
            w: 300
          }]
        }
      ]
    }
  };

  const badResponse = {
    body: {
      cur: 'EUR',
      id: 'bidid1',
      seatbid: []
    }
  };

  const bidBannerRequest = {
    data: {},
    bidRequests: [{bidId: '1', sizes: [300, 250]}]
  };

  it('should return null if body is missing or empty', function () {
    const result = spec.interpretResponse(badResponse, bidBannerRequest);
    assert.equal(result.length, 0);
  });
});

})
;


/*
describe('interpretResponse', function () {
  const goodBannerResponse = {
    body: {
      cur: 'EUR',
      id: 'bidid1',
      seatbid: [
        {
          seat: 'seedingAlliance',
          bid: [{
            adm: '<iframe src="https://domain.tld/cds/delivery?wp=0.90"></iframe>',
            impid: 1,
            price: 0.90,
            h: 250,
            w: 300
          }]
        }
      ]
    }
  };

  const badResponse = { body: {
    cur: 'EUR',
    id: 'bidid1',
    seatbid: []
  }};

  const bidBannerRequest = {
    data: {},
    bidRequests: [{bidId: '1', sizes: [300, 250]}]
  };

  it('should return null if body is missing or empty', function () {
    const result = spec.interpretResponse(badResponse, bidBannerRequest);
    assert.equal(result.length, 0);
  });

  it('should return the correct params', function () {
    const resultBanner = spec.interpretResponse(goodBannerResponse, bidBannerRequest);

    assert.deepEqual(resultBanner[0].mediaType, 'banner');
    assert.deepEqual(resultBanner[0].width, bidBannerRequest.bidRequests[0].sizes[0]);
    assert.deepEqual(resultBanner[0].height, bidBannerRequest.bidRequests[0].sizes[1]);
  });

  it('should return the correct banner content', function () {
    const result = spec.interpretResponse(goodBannerResponse, bidBannerRequest);
    const bid = goodBannerResponse.body.seatbid[0].bid[0];
    const regExpContent = new RegExp('<iframe.+?' + bid.price + '.+?</iframe>');

    assert.ok(result[0].ad.search(regExpContent) > -1);
  });
});
})
;*/
