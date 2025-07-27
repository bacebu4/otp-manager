# TOTP Code Generator Chrome Extension

A Chrome extension that generates Time-based One-Time Password (TOTP) codes for websites with local storage and convenient auto-fill functionality.

> [!WARNING]
> Most of the code was generated with Claude

[Download in Chrome Web Store](https://chromewebstore.google.com/detail/gedmajfchdeamaieekfiobdfpdheaoob?utm_source=item-share-cb)

## Features

- **Domain-based**: Secrets are automatically filtered by the current website domain
- **Local Storage**: All secrets are stored locally in Chrome's storage, never transmitted
- **Auto-fill Shortcut**: Generate and paste TOTP codes directly into input fields using `Ctrl+Shift+T` (or `Cmd+Shift+T` on Mac)
- **Import/Export**: Backup and restore your secrets in JSON format

## Manual Installation

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right corner
4. Click "Load unpacked" and select the extension directory
5. The TOTP Generator extension should now appear in your extensions list

## Security

- All secrets are stored locally using Chrome's `chrome.storage.local` API
- No network requests are made
- Secrets are isolated by domain
- All cryptographic operations are performed client-side

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Support

For issues and feature requests, please create an issue on the GitHub repository.