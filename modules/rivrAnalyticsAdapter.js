import {ajax} from '../src/ajax.js';
import adapter from '../libraries/analyticsAdapter/AnalyticsAdapter.js';
import adapterManager from '../src/adapterManager.js';
import * as utils from '../src/utils.js';
import {getGlobal} from '../src/prebidGlobal.js';

const analyticsType = 'endpoint';

const rivrAnalytics = Object.assign(adapter({analyticsType}), {
  track({ eventType, args }) {
    if (window.rivraddon && window.rivraddon.analytics && window.rivraddon.analytics.getContext() && window.rivraddon.analytics.trackPbjsEvent) {
      utils.logInfo(`ARGUMENTS FOR TYPE: ============= ${eventType}`, args);
      window.rivraddon.analytics.trackPbjsEvent({ eventType, args });
    }
  }
});

// save the base class function
rivrAnalytics.originEnableAnalytics = rivrAnalytics.enableAnalytics;

// override enableAnalytics so we can get access to the config passed in from the page
rivrAnalytics.enableAnalytics = (config) => {
  if (window.rivraddon && window.rivraddon.analytics) {
    window.rivraddon.analytics.enableAnalytics(config, {utils, ajax, pbjsGlobalVariable: getGlobal()});
    rivrAnalytics.originEnableAnalytics(config);
  }
};

adapterManager.registerAnalyticsAdapter({
  adapter: rivrAnalytics,
  code: 'rivr'
});

export default rivrAnalytics;
