# Release Dependency Security Triage

Reviewed 2026-10-15. Initial npm audit: 13 findings (3 critical, 6 high,
2 moderate, 2 low). Targeted compatible updates, **not npm audit fix**:

| Chain | Resolved version / rationale |
| --- | --- |
| multer | 2.4.0, fixes multipart/aborted-upload findings; current authenticated memoryStorage OCR path retained |
| proxy-addr | 2.0.8, IPv4-mapped IPv6 trust-subnet advisory; invitation parser still separately validates configured trusted networks |
| concurrently / shell-quote | 9.2.5 / 1.12.0, command-quoting and parser DoS development chain |
| Vite / esbuild | 7.3.7 / 0.28.2, Windows development-server file disclosure; remain on Vite 7 |
| body-parser / qs | 2.3.0 / 6.16.1, parsing/limit DoS fixes; existing JSON body limits retained |
| PostCSS / nanoid / source-map-js | 8.5.30 / 3.3.20 / 1.2.2, source-map parsing and size/offset fixes |
| Browserslist / baseline-browser-mapping | 4.29.3 / 2.11.29, build-tool query/input DoS fixes |

Explicit commands updated multer, Vite, concurrently and the listed vulnerable
transitives within compatible constraints. Capacitor/Camera, React and native
configuration were NOT upgraded. package-lock.json pins the reviewed resolution.

Final `npm audit` and `npm audit --omit=dev`: **0 known vulnerabilities** at the
time checked. This is not a guarantee that dependencies contain no security defects.
Full unit/SQL, web/mobile builds and responsive scanner/Settings browser checks were
rerun after the updates. Backend patches require a separate approved deployment;
changing the feature branch does not patch the currently hosted backend.

Maintainer references:

- https://github.com/expressjs/multer/security/advisories
- https://github.com/jshttp/proxy-addr/security/advisories/GHSA-jqcg-44mw-7w3h
- https://github.com/vitejs/vite/security/advisories/GHSA-fx2h-pf6j-xcff
- Other exact advisory IDs/affected ranges were inspected in npm audit JSON. Recheck
  advisories and the lock when building the eventual backend release; don't introduce
  unrelated major upgrades during stabilization.
