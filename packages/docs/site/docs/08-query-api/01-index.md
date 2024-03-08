---
sidebar_position: 5
slug: /query-api
---

# Query API

WordPress Playground exposes a simple API that you can use to configure the Playground in the browser.

It works by passing configuration options as query parameters to the Playground URL. For example, to install the pendant theme, you would use the following URL:

```text
https://playground.wordpress.net/?theme=pendant
```

You can go ahead and try it out. The Playground will automatically install the theme and log you in as an admin. You may even embed this URL in your website using an `<iframe>` tag:

```html
<iframe src="https://playground.wordpress.net/?theme=pendant"></iframe>
```

## Available options

| Option                 | Default Value                                   | Description                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `php`                  | `8.0`                                           | Loads the specified PHP version. Supported values: `7.0`, `7.1`, `7.2`, `7.3`, `7.4`, `8.0`, `8.1`, `8.2`, `8.3`, `latest`                                                                                                                                                                                                                                     |
| `wp`                   | `latest`                                        | Loads the specified WordPress version. Supported values: `6.0`, `6.1`, `6.2`, `6.3`, `6.4`, `latest`, `nightly`, `beta`                                                                                                                                                                                                                                        |
| `blueprint-url`        |                                                 | The URL of the Blueprint that will be used to configure this Playground instance.                                                                                                                                                                                                                                                                              |
| `php-extension-bundle` |                                                 | Loads a bundle of PHP extensions. Supported bundles: `kitchen-sink` (for gd, mbstring, iconv, openssl, libxml, xml, dom, simplexml, xmlreader, xmlwriter)                                                                                                                                                                                                      |
| `networking`           | `yes` or `no`                                   | Enables or disables the networking support for Playground. Defaults to `no`                                                                                                                                                                                                                                                                                    |
| `plugin`               |                                                 | Installs the specified plugin. Use the plugin name from the plugins directory URL, e.g. for a URL like `https://wordpress.org/plugins/wp-lazy-loading/`, the plugin name would be `wp-lazy-loading`. You can pre-install multiple plugins by saying `plugin=coblocks&plugin=wp-lazy-loading&…`. Installing a plugin automatically logs the user in as an admin |
| `theme`                |                                                 | Installs the specified theme. Use the theme name from the themes directory URL, e.g. for a URL like `https://wordpress.org/themes/disco/`, the theme name would be `disco`. Installing a theme automatically logs the user in as an admin                                                                                                                      |
| `url`                  | `/wp-admin/`                                    | Load the specified initial page displaying WordPress                                                                                                                                                                                                                                                                                                           |
| `mode`                 | `seamless`, `browser`, or `browser-full-screen` | Displays WordPress on a full-page or wraps it in a browser UI                                                                                                                                                                                                                                                                                                  |
| `lazy`                 |                                                 | Defer loading the Playground assets until someone clicks on the "Run" button                                                                                                                                                                                                                                                                                   |
| `login`                | `yes`                                           | Logs the user in as an admin. Set to `no` to not log in.                                                                                                                                                                                                                                                                                                       |
| `multisite`            | `no`                                            | Enables the WordPress multisite mode.                                                                                                                                                                                                                                                                                                                          |
| `storage`              |                                                 | Selects the storage for Playground: `none` gets erased on page refresh, `browser` is stored in the browser, and `device` is stored in the selected directory on a device. The last two protect the user from accidentally losing their work upon page refresh.                                                                                                 |
| `import-site`          |                                                 | Imports site files and database from a zip file specified by URL.                                                                                                                                                                                                                                                                                              |
| `import-content`       |                                                 | Imports site content from a WXR or WXZ file specified by URL. It uses the WordPress Importer, so the default admin user must be logged in.                                                                                                                                                                                                                     |

For example, the following code embeds a Playground with a preinstalled Gutenberg plugin, and opens the post editor:

```html
<iframe src="https://playground.wordpress.net/?plugin=elementor&url=/wp-admin/post-new.php&mode=seamless"> </iframe>
```

:::info CORS policy

To import files from a URL, such as a site zip package, they must be served with `Access-Control-Allow-Origin` header set. For reference, see: [Cross-Origin Resource Sharing (CORS)](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS#the_http_response_headers).

:::
