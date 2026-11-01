// The demo compiles the real application with an isolated, browser-only adapter.
// The ordinary /app/ module is never transformed.
export function demoAppPlugin() {
  return {
    name: 'binflow-isolated-demo', enforce: 'pre',
    transform(source, id) {
      const normalized = id.replaceAll('\\', '/');
      if (normalized.endsWith('/src/AccountSettings.jsx?demo')) return source
        .replace('We could not confirm that this account can be deleted safely. Contact BinFlow support for the next steps.', 'This is a fictional demo account. Account deletion is available only in your real account.')
        .replace('Account deletion is not available right now. Please try again later or contact', 'No account can be deleted from this demo. Questions? Contact');
      if (normalized.endsWith('/src/FarmInvitationSettings.jsx?demo')) return source
        .replace('Share your farm code only with people you authorize to join as Employees.', 'Demo code only: this example cannot join a real farm. In your account, share your farm code only with people you authorize to join as Employees.');
      if (!normalized.endsWith('/src/main.jsx?demo')) return;
      return source
        .replace("from './AccountSettings.jsx'", "from './AccountSettings.jsx?demo'")
        .replace("from './FarmInvitationSettings.jsx'", "from './FarmInvitationSettings.jsx?demo'")
        .replace("from './supabaseAuth.js'", "from '../demo/runtime.js'")
        .replace("from './network.js'", "from '../demo/runtime.js'")
        .replace(/^const API_BASE = .*;$/m, "const API_BASE = 'https://demo.invalid';")
        .replaceAll('localStorage', 'demoStorage')
        .replace("import React,", "import { demoStorage } from '../demo/runtime.js';\nimport React,")
        .replaceAll('>Log Out</button>', '>Exit Demo</button>')
        .replace('Choose or take a photo to begin.', 'Demo: choose a photo to try the review flow. Extraction returns fictional sample fields, not your image contents.')
        .replace('Extraction complete. Review every field before submitting.', 'Sample fields loaded. These fictional values were not read from your photo. Review every field before saving to the demo.');
    }
  };
}
