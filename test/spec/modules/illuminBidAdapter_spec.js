import {expect} from 'chai';
import {
  spec as adapter,
  createDomain,
  storage
} from 'modules/illuminBidAdapter.js';
import * as utils from 'src/utils.js';
import {version} from 'package.json';
import {useFakeTimers} from 'sinon';
import {BANNER, VIDEO} from '../../../src/mediaTypes.js';
import {config} from '../../../src/config.js';
import {
  hashCode,
  extractPID,
  extractCID,
  extractSubDomain,
  getStorageItem,
  setStorageItem,
  tryParseJSON,
  getUniqueDealId,
} from '../../../libraries/vidazooUtils/bidderUtils.js';
import {getGlobal} from '../../../src/prebidGlobal.js';

export const TEST_ID_SYSTEMS = ['criteoId', 'id5id', 'idl_env', 'lipb', 'netId', 'pubcid', 'tdid', 'pubProvidedId'];

const SUB_DOMAIN = 'exchange';

const BID = {
  'bidId': '2d52001cabd527',
  'adUnitCode': 'div-gpt-ad-12345-0',
  'params': {
    'subDomain': SUB_DOMAIN,
    'cId': '59db6b3b4ffaa70004f45cdc',
    'pId': '59ac17c192832d0011283fe3',
    'bidFloor': 0.1,
    'ext': {
      'param1': 'loremipsum',
      'param2': 'dolorsitamet'
    }
  },
  'placementCode': 'div-gpt-ad-1460505748561-0',
  'sizes': [[300, 250], [300, 600]],
  'bidderRequestId': '1fdb5ff1b6eaa7',
  'bidRequestsCount': 4,
  'bidderRequestsCount': 3,
  'bidderWinsCount': 1,
  'requestId': 'b0777d85-d061-450e-9bc7-260dd54bbb7a',
  'schain': 'a0819c69-005b-41ed-af06-1be1e0aefefc',
  'mediaTypes': [BANNER],
  'ortb2Imp': {
    'ext': {
      'gpid': '0123456789',
      'tid': '56e184c6-bde9-497b-b9b9-cf47a61381ee'
    }
  }
};

const VIDEO_BID = {
  'bidId': '2d52001cabd527',
  'adUnitCode': '63550ad1ff6642d368cba59dh5884270560',
  'bidderRequestId': '12a8ae9ada9c13',
  'bidRequestsCount': 4,
  'bidderRequestsCount': 3,
  'bidderWinsCount': 1,
  'schain': 'a0819c69-005b-41ed-af06-1be1e0aefefc',
  'params': {
    'subDomain': SUB_DOMAIN,
    'cId': '635509f7ff6642d368cb9837',
    'pId': '59ac17c192832d0011283fe3',
    'bidFloor': 0.1
  },
  'sizes': [[545, 307]],
  'mediaTypes': {
    'video': {
      'playerSize': [[545, 307]],
      'context': 'instream',
      'mimes': [
        'video/mp4',
        'application/javascript'
      ],
      'protocols': [2, 3, 5, 6],
      'maxduration': 60,
      'minduration': 0,
      'startdelay': 0,
      'linearity': 1,
      'api': [2],
      'placement': 1
    }
  },
  'ortb2Imp': {
    'ext': {
      'gpid': '0123456789',
      'tid': '56e184c6-bde9-497b-b9b9-cf47a61381ee'
    }
  }
}

const ORTB2_DEVICE = {
  sua: {
    'source': 2,
    'platform': {
      'brand': 'Android',
      'version': ['8', '0', '0']
    },
    'browsers': [
      {'brand': 'Not_A Brand', 'version': ['99', '0', '0', '0']},
      {'brand': 'Google Chrome', 'version': ['109', '0', '5414', '119']},
      {'brand': 'Chromium', 'version': ['109', '0', '5414', '119']}
    ],
    'mobile': 1,
    'model': 'SM-G955U',
    'bitness': '64',
    'architecture': ''
  },
  w: 980,
  h: 1720,
  dnt: 0,
  ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/125.0.6422.80 Mobile/15E148 Safari/604.1',
  language: 'en',
  devicetype: 1,
  make: 'Apple',
  model: 'iPhone 12 Pro Max',
  os: 'iOS',
  osv: '17.4',
  ext: {fiftyonedegrees_deviceId: '17595-133085-133468-18092'},
};

const BIDDER_REQUEST = {
  'gdprConsent': {
    'consentString': 'consent_string',
    'gdprApplies': true
  },
  'gppString': 'gpp_string',
  'gppSid': [7],
  'uspConsent': 'consent_string',
  'refererInfo': {
    'page': 'https://www.greatsite.com',
    'ref': 'https://www.somereferrer.com'
  },
  'ortb2': {
    'site': {
      'content': {
        'language': 'en'
      }
    },
    'regs': {
      'gpp': 'gpp_string',
      'gpp_sid': [7],
      'coppa': 0
    },
    'device': ORTB2_DEVICE,
  }
};

const SERVER_RESPONSE = {
  body: {
    cid: 'testcid123',
    results: [{
      'ad': '<iframe>console.log("hello world")</iframe>',
      'price': 0.8,
      'creativeId': '12610997325162499419',
      'exp': 30,
      'width': 300,
      'height': 250,
      'advertiserDomains': ['securepubads.g.doubleclick.net'],
      'cookies': [{
        'src': 'https://sync.com',
        'type': 'iframe'
      }, {
        'src': 'https://sync.com',
        'type': 'img'
      }]
    }]
  }
};

const VIDEO_SERVER_RESPONSE = {
  body: {
    'cid': '635509f7ff6642d368cb9837',
    'results': [{
      'ad': '<VAST version=\"3.0\" xmlns:xs=\"http://www.w3.org/2001/XMLSchema\"></VAST>',
      'advertiserDomains': ['illumin.com'],
      'exp': 60,
      'width': 545,
      'height': 307,
      'mediaType': 'video',
      'creativeId': '12610997325162499419',
      'price': 2,
      'cookies': []
    }]
  }
};

const REQUEST = {
  data: {
    width: 300,
    height: 250,
    bidId: '2d52001cabd527'
  }
};

function getTopWindowQueryParams() {
  try {
    const parsedUrl = utils.parseUrl(window.top.document.URL, {decodeSearchAsString: true});
    return parsedUrl.search;
  } catch (e) {
    return '';
  }
}

describe('IlluminBidAdapter', function () {
  before(() => config.resetConfig());
  after(() => config.resetConfig());

  describe('validtae spec', function () {
    it('exists and is a function', function () {
      expect(adapter.isBidRequestValid).to.exist.and.to.be.a('function');
    });

    it('exists and is a function', function () {
      expect(adapter.buildRequests).to.exist.and.to.be.a('function');
    });

    it('exists and is a function', function () {
      expect(adapter.interpretResponse).to.exist.and.to.be.a('function');
    });

    it('exists and is a function', function () {
      expect(adapter.getUserSyncs).to.exist.and.to.be.a('function');
    });

    it('exists and is a string', function () {
      expect(adapter.code).to.exist.and.to.be.a('string');
    });

    it('exists and contains media types', function () {
      expect(adapter.supportedMediaTypes).to.exist.and.to.be.an('array').with.length(2);
      expect(adapter.supportedMediaTypes).to.contain.members([BANNER, VIDEO]);
    });
  });

  describe('validate bid requests', function () {
    it('should require cId', function () {
      const isValid = adapter.isBidRequestValid({
        params: {
          pId: 'pid'
        }
      });
      expect(isValid).to.be.false;
    });

    it('should require pId', function () {
      const isValid = adapter.isBidRequestValid({
        params: {
          cId: 'cid'
        }
      });
      expect(isValid).to.be.false;
    });

    it('should validate correctly', function () {
      const isValid = adapter.isBidRequestValid({
        params: {
          cId: 'cid',
          pId: 'pid'
        }
      });
      expect(isValid).to.be.true;
    });
  });

  describe('build requests', function () {
    let sandbox;
    before(function () {
      getGlobal().bidderSettings = {
        illumin: {
          storageAllowed: true
        }
      };
      sandbox = sinon.createSandbox();
      sandbox.stub(Date, 'now').returns(1000);
    });

    it('should build video request', function () {
      const hashUrl = hashCode(BIDDER_REQUEST.refererInfo.page);
      config.setConfig({
        bidderTimeout: 3000,
        enableTIDs: true
      });
      const requests = adapter.buildRequests([VIDEO_BID], BIDDER_REQUEST);
      expect(requests).to.have.length(1);
      expect(requests[0]).to.deep.equal({
        method: 'POST',
        url: `${createDomain(SUB_DOMAIN)}/prebid/multi/635509f7ff6642d368cb9837`,
        data: {
          adUnitCode: '63550ad1ff6642d368cba59dh5884270560',
          bidFloor: 0.1,
          bidId: '2d52001cabd527',
          bidderVersion: adapter.version,
          bidderRequestId: '12a8ae9ada9c13',
          cb: 1000,
          gdpr: 1,
          gdprConsent: 'consent_string',
          usPrivacy: 'consent_string',
          gppString: 'gpp_string',
          gppSid: [7],
          transactionId: '56e184c6-bde9-497b-b9b9-cf47a61381ee',
          prebidVersion: version,
          bidRequestsCount: 4,
          bidderRequestsCount: 3,
          bidderWinsCount: 1,
          bidderTimeout: 3000,
          publisherId: '59ac17c192832d0011283fe3',
          url: 'https%3A%2F%2Fwww.greatsite.com',
          referrer: 'https://www.somereferrer.com',
          res: `${window.top.screen.width}x${window.top.screen.height}`,
          schain: VIDEO_BID.schain,
          sizes: ['545x307'],
          sua: {
            'source': 2,
            'platform': {
              'brand': 'Android',
              'version': ['8', '0', '0']
            },
            'browsers': [
              {'brand': 'Not_A Brand', 'version': ['99', '0', '0', '0']},
              {'brand': 'Google Chrome', 'version': ['109', '0', '5414', '119']},
              {'brand': 'Chromium', 'version': ['109', '0', '5414', '119']}
            ],
            'mobile': 1,
            'model': 'SM-G955U',
            'bitness': '64',
            'architecture': ''
          },
          device: ORTB2_DEVICE,
          uniqueDealId: `${hashUrl}_${Date.now().toString()}`,
          uqs: getTopWindowQueryParams(),
          mediaTypes: {
            video: {
              api: [2],
              context: 'instream',
              linearity: 1,
              maxduration: 60,
              mimes: [
                'video/mp4',
                'application/javascript'
              ],
              minduration: 0,
              placement: 1,
              playerSize: [[545, 307]],
              protocols: [2, 3, 5, 6],
              startdelay: 0
            }
          },
          gpid: '0123456789',
          cat: [],
          contentData: [],
          contentLang: 'en',
          isStorageAllowed: true,
          pagecat: [],
          userData: [],
          coppa: 0
        }
      });
    });

    it('should build banner request for each size', function () {
      const hashUrl = hashCode(BIDDER_REQUEST.refererInfo.page);
      config.setConfig({
        bidderTimeout: 3000,
        enableTIDs: true
      });
      const requests = adapter.buildRequests([BID], BIDDER_REQUEST);
      expect(requests).to.have.length(1);
      expect(requests[0]).to.deep.equal({
        method: 'POST',
        url: `${createDomain(SUB_DOMAIN)}/prebid/multi/59db6b3b4ffaa70004f45cdc`,
        data: {
          gdprConsent: 'consent_string',
          gdpr: 1,
          gppString: 'gpp_string',
          gppSid: [7],
          usPrivacy: 'consent_string',
          bidRequestsCount: 4,
          bidderRequestsCount: 3,
          bidderWinsCount: 1,
          bidderTimeout: 3000,
          bidderRequestId: '1fdb5ff1b6eaa7',
          transactionId: '56e184c6-bde9-497b-b9b9-cf47a61381ee',
          sizes: ['300x250', '300x600'],
          sua: {
            'source': 2,
            'platform': {
              'brand': 'Android',
              'version': ['8', '0', '0']
            },
            'browsers': [
              {'brand': 'Not_A Brand', 'version': ['99', '0', '0', '0']},
              {'brand': 'Google Chrome', 'version': ['109', '0', '5414', '119']},
              {'brand': 'Chromium', 'version': ['109', '0', '5414', '119']}
            ],
            'mobile': 1,
            'model': 'SM-G955U',
            'bitness': '64',
            'architecture': ''
          },
          device: ORTB2_DEVICE,
          url: 'https%3A%2F%2Fwww.greatsite.com',
          referrer: 'https://www.somereferrer.com',
          cb: 1000,
          bidFloor: 0.1,
          bidId: '2d52001cabd527',
          adUnitCode: 'div-gpt-ad-12345-0',
          publisherId: '59ac17c192832d0011283fe3',
          uniqueDealId: `${hashUrl}_${Date.now().toString()}`,
          bidderVersion: adapter.version,
          prebidVersion: version,
          schain: BID.schain,
          res: `${window.top.screen.width}x${window.top.screen.height}`,
          mediaTypes: [BANNER],
          gpid: '0123456789',
          uqs: getTopWindowQueryParams(),
          'ext.param1': 'loremipsum',
          'ext.param2': 'dolorsitamet',
          cat: [],
          contentData: [],
          contentLang: 'en',
          isStorageAllowed: true,
          pagecat: [],
          userData: [],
          coppa: 0
        }
      });
    });

    after(function () {
      getGlobal().bidderSettings = {};
      sandbox.restore();
    });
  });
  describe('getUserSyncs', function () {
    it('should have valid user sync with iframeEnabled', function () {
      const result = adapter.getUserSyncs({iframeEnabled: true}, [SERVER_RESPONSE]);

      expect(result).to.deep.equal([{
        type: 'iframe',
        url: 'https://sync.illumin.com/api/sync/iframe/?cid=testcid123&gdpr=0&gdpr_consent=&us_privacy=&coppa=0'
      }]);
    });

    it('should have valid user sync with cid on response', function () {
      const result = adapter.getUserSyncs({iframeEnabled: true}, [SERVER_RESPONSE]);
      expect(result).to.deep.equal([{
        type: 'iframe',
        url: 'https://sync.illumin.com/api/sync/iframe/?cid=testcid123&gdpr=0&gdpr_consent=&us_privacy=&coppa=0'
      }]);
    });

    it('should have valid user sync with pixelEnabled', function () {
      const result = adapter.getUserSyncs({pixelEnabled: true}, [SERVER_RESPONSE]);

      expect(result).to.deep.equal([{
        'url': 'https://sync.illumin.com/api/sync/image/?cid=testcid123&gdpr=0&gdpr_consent=&us_privacy=&coppa=0',
        'type': 'image'
      }]);
    })

    it('should have valid user sync with coppa on response', function () {
      config.setConfig({
        coppa: 1
      });
      const result = adapter.getUserSyncs({iframeEnabled: true}, [SERVER_RESPONSE]);
      expect(result).to.deep.equal([{
        type: 'iframe',
        url: 'https://sync.illumin.com/api/sync/iframe/?cid=testcid123&gdpr=0&gdpr_consent=&us_privacy=&coppa=1'
      }]);
    });
  });

  describe('interpret response', function () {
    it('should return empty array when there is no response', function () {
      const responses = adapter.interpretResponse(null);
      expect(responses).to.be.empty;
    });

    it('should return empty array when there is no ad', function () {
      const responses = adapter.interpretResponse({price: 1, ad: ''});
      expect(responses).to.be.empty;
    });

    it('should return empty array when there is no price', function () {
      const responses = adapter.interpretResponse({price: null, ad: 'great ad'});
      expect(responses).to.be.empty;
    });

    it('should return an array of interpreted banner responses', function () {
      const responses = adapter.interpretResponse(SERVER_RESPONSE, REQUEST);
      expect(responses).to.have.length(1);
      expect(responses[0]).to.deep.equal({
        requestId: '2d52001cabd527',
        cpm: 0.8,
        width: 300,
        height: 250,
        creativeId: '12610997325162499419',
        currency: 'USD',
        netRevenue: true,
        ttl: 30,
        ad: '<iframe>console.log("hello world")</iframe>',
        meta: {
          advertiserDomains: ['securepubads.g.doubleclick.net']
        }
      });
    });

    it('should get meta from response metaData', function () {
      const serverResponse = utils.deepClone(SERVER_RESPONSE);
      serverResponse.body.results[0].metaData = {
        advertiserDomains: ['illumin.com'],
        agencyName: 'Agency Name',
      };
      const responses = adapter.interpretResponse(serverResponse, REQUEST);
      expect(responses[0].meta).to.deep.equal({
        advertiserDomains: ['illumin.com'],
        agencyName: 'Agency Name'
      });
    });

    it('should return an array of interpreted video responses', function () {
      const responses = adapter.interpretResponse(VIDEO_SERVER_RESPONSE, REQUEST);
      expect(responses).to.have.length(1);
      expect(responses[0]).to.deep.equal({
        requestId: '2d52001cabd527',
        cpm: 2,
        width: 545,
        height: 307,
        mediaType: 'video',
        creativeId: '12610997325162499419',
        currency: 'USD',
        netRevenue: true,
        ttl: 60,
        vastXml: '<VAST version=\"3.0\" xmlns:xs=\"http://www.w3.org/2001/XMLSchema\"></VAST>',
        meta: {
          advertiserDomains: ['illumin.com']
        }
      });
    });

    it('should take default TTL', function () {
      const serverResponse = utils.deepClone(SERVER_RESPONSE);
      delete serverResponse.body.results[0].exp;
      const responses = adapter.interpretResponse(serverResponse, REQUEST);
      expect(responses).to.have.length(1);
      expect(responses[0].ttl).to.equal(300);
    });
  });

  describe('user id system', function () {
    TEST_ID_SYSTEMS.forEach((idSystemProvider) => {
      const id = Date.now().toString();
      const bid = utils.deepClone(BID);

      const userId = (function () {
        switch (idSystemProvider) {
          case 'lipb':
            return {lipbid: id};
          case 'id5id':
            return {uid: id};
          default:
            return id;
        }
      })();

      bid.userId = {
        [idSystemProvider]: userId
      };

      it(`should include 'uid.${idSystemProvider}' in request params`, function () {
        const requests = adapter.buildRequests([bid], BIDDER_REQUEST);
        expect(requests[0].data[`uid.${idSystemProvider}`]).to.equal(id);
      });
    });
  });

  describe('alternate param names extractors', function () {
    it('should return undefined when param not supported', function () {
      const cid = extractCID({'c_id': '1'});
      const pid = extractPID({'p_id': '1'});
      const subDomain = extractSubDomain({'sub_domain': 'prebid'});
      expect(cid).to.be.undefined;
      expect(pid).to.be.undefined;
      expect(subDomain).to.be.undefined;
    });

    it('should return value when param supported', function () {
      const cid = extractCID({'cId': '1'});
      const pid = extractPID({'pId': '2'});
      const subDomain = extractSubDomain({'subDomain': 'prebid'});
      expect(cid).to.be.equal('1');
      expect(pid).to.be.equal('2');
      expect(subDomain).to.be.equal('prebid');
    });
  });

  describe('unique deal id', function () {
    before(function () {
      getGlobal().bidderSettings = {
        illumin: {
          storageAllowed: true
        }
      };
    });
    after(function () {
      getGlobal().bidderSettings = {};
    });
    const key = 'myKey';
    let uniqueDealId;
    beforeEach(() => {
      uniqueDealId = getUniqueDealId(storage, key, 0);
    })

    it('should get current unique deal id', function (done) {
      // waiting some time so `now` will become past
      setTimeout(() => {
        const current = getUniqueDealId(storage, key);
        expect(current).to.be.equal(uniqueDealId);
        done();
      }, 200);
    });

    it('should get new unique deal id on expiration', function (done) {
      setTimeout(() => {
        const current = getUniqueDealId(storage, key, 100);
        expect(current).to.not.be.equal(uniqueDealId);
        done();
      }, 200)
    });
  });

  describe('storage utils', function () {
    before(function () {
      getGlobal().bidderSettings = {
        illumin: {
          storageAllowed: true
        }
      };
    });
    after(function () {
      getGlobal().bidderSettings = {};
    });
    it('should get value from storage with create param', function () {
      const now = Date.now();
      const clock = useFakeTimers({
        shouldAdvanceTime: true,
        now
      });
      setStorageItem(storage, 'myKey', 2020);
      const {value, created} = getStorageItem(storage, 'myKey');
      expect(created).to.be.equal(now);
      expect(value).to.be.equal(2020);
      expect(typeof value).to.be.equal('number');
      expect(typeof created).to.be.equal('number');
      clock.restore();
    });

    it('should get external stored value', function () {
      const value = 'superman'
      window.localStorage.setItem('myExternalKey', value);
      const item = getStorageItem(storage, 'myExternalKey');
      expect(item).to.be.equal(value);
    });

    it('should parse JSON value', function () {
      const data = JSON.stringify({event: 'send'});
      const {event} = tryParseJSON(data);
      expect(event).to.be.equal('send');
    });

    it('should get original value on parse fail', function () {
      const value = 21;
      const parsed = tryParseJSON(value);
      expect(typeof parsed).to.be.equal('number');
      expect(parsed).to.be.equal(value);
    });
  });
});
