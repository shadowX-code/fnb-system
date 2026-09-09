# Production hostname separation

Production routes `feedx.my` to a public-only homepage using the shared FeedX visual shell, with no authentication controls. Routing middleware redirects non-root public paths to the public root. `os.feedx.my` and `feedx-os.vercel.app` retain the existing operational application flow. Staging host behavior is unchanged, and hostname routing does not replace Auth, RBAC, or RLS.
