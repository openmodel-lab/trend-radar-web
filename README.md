# Trend Radar Web

Responsive PRIVATE dashboard prototype for PC and iPhone.

## Security

- The browser uses only the Supabase publishable key.
- PRIVATE data is protected by Supabase RLS.
- Access is granted through `private_dashboard_access`.
- No service role / secret key is included in frontend code.

## Login policy

v0.1 does not expose public sign-up from the web UI.

1. Create the single intended user through a trusted Supabase Auth admin flow.
2. Add that user ID to `private_dashboard_access`.
3. Open the deployed page and log in.
4. RLS allows PRIVATE data only for allowlisted authenticated users.

The public repository must never contain service-role / secret keys or PRIVATE data.

## Hosting

A GitHub Pages workflow is included at:

`.github/workflows/trend-radar-pages.yml`

GitHub Pages must be enabled once in repository settings with GitHub Actions as the source.
