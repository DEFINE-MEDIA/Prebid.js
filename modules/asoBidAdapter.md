# Overview

```
Module Name: Adserver.Online Bidder Adapter
Module Type: Bidder Adapter
Maintainer: support@adsrv.org
```

# Description

Adserver.Online Bidder Adapter for Prebid.js.

For more information, please visit [Adserver.Online](https://adserver.online).

# Parameters

| Name      | Scope    | Description             | Example                | Type       |
|-----------|----------|-------------------------|------------------------|------------|
| `zone`    | required | Zone ID                 | `73815`                | `Integer`  |
| `server`  | optional | Custom bidder endpoint  | `https://endpoint.url` | `String`   |

# Test parameters for banner
```js
var adUnits = [
    {
        code: 'banner1',
        mediaTypes: {
            banner: {
                sizes: [[300, 250]],
            }
        },
        bids: [
            {
                bidder: 'aso',
                params: {
                    zone: 73815
                }
            }
        ]
    }
];
```

# Test parameters for video
```js
var videoAdUnit = [
    {
        code: 'video1',
        mediaTypes: {
            video: {
                mimes: [
                   "video/mp4"
                ],
                playerSize: [[640, 480]],
                context: 'instream' // or 'outstream'
            }
        },
        bids: [{
            bidder: 'aso',
            params: {
                zone: 34668
            }
        }]
    }
];
```

# Configuration

The Adserver.Online Bid Adapter expects Prebid Cache (for video) to be enabled.

```
pbjs.setConfig({
    cache: {
        url: 'https://prebid.example.com/pbc/v1/cache'
    }
});
```
