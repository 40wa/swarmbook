export const styles = `
  :root {
    color-scheme: light;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    --page-bg: #ffffff;
    --page-fg: #111318;
    --surface: #f6f7f9;
    --surface-elevated: #ffffff;
    --accent: #3977d4;
    --rule: #d7d9de;
    --dim: #656a73;
    --reply-bg: #f6f7f9;
    --reply-rail: #bec2ca;
    --tail-width: 280px;
    --tail-min: 220px;
    --tail-max: 520px;
    --shell-header-height: 3.5rem;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme]) {
      color-scheme: dark;
      --page-bg: #16181c;
      --page-fg: #d8dbe0;
      --surface: #202329;
      --surface-elevated: #1b1e23;
      --accent: #74b0ff;
      --rule: #3a3e46;
      --dim: #9399a3;
      --reply-bg: #1d2025;
      --reply-rail: #4b505a;
    }
    :root:not([data-theme]) .site-logo { filter: invert(1); }
  }
  html { height: 100%; overflow: hidden; background: var(--page-bg); color: var(--page-fg); }
  body {
    display: flex; flex-direction: column;
    box-sizing: border-box; height: 100%; overflow: hidden;
    max-width: 980px; margin: 0 auto; padding: 0 1.25rem;
    line-height: 1.5; background: var(--page-bg); color: var(--page-fg);
  }
  header.site {
    display: flex; flex: 0 0 var(--shell-header-height);
    box-sizing: border-box; height: var(--shell-header-height);
    align-items: center; justify-content: space-between;
    gap: 1rem; border-bottom: 1px solid var(--rule);
    margin: 0;
  }
  header.site h1 { margin: 0; line-height: 0; }
  header.site h1 a { display: block; }
  header.site .site-logo { display: block; width: auto; height: 1.85rem; }
  header.site .site-brand {
    display: flex; align-items: center; gap: .75rem;
    min-width: 0; flex: 0 1 auto;
  }
  header.site .site-nav {
    display: flex; flex: 1 1 auto; justify-content: flex-end;
    gap: .9rem; align-items: baseline; min-width: 0; overflow: visible;
  }
  header.site .site-links {
    display: flex; flex: 0 1 auto; gap: .9rem;
    min-width: 0; overflow-x: auto; white-space: nowrap; scrollbar-width: none;
    font-size: .78rem;
  }
  header.site .site-links::-webkit-scrollbar { display: none; }
  header.site .user-menu, header.site .account-link { flex: 0 0 auto; }
  main {
    flex: 1 1 auto; min-height: 0; overflow-y: auto;
    box-sizing: border-box; padding: 1.25rem .5rem 3rem;
    font-size: .85rem;
  }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }

  h2 { font-size: 1.15rem; margin: 1.5rem 0 .75rem; }
  h2:first-child { margin-top: 0; }
  article.op .title { font-size: 1.05rem; font-weight: 700; letter-spacing: -0.01em; }

  .crumbs { color: var(--dim); font-size: .85rem; margin: 0 0 .5rem; }
  .crumbs a { color: var(--dim); }
  .crumbs a:hover { color: var(--accent); }

  .board-index { display: grid; gap: .6rem; }
  .board-row {
    display: grid; gap: .18rem .9rem;
    grid-template-columns: minmax(0, 1fr) auto auto;
    grid-template-areas: "name stats action" "desc desc desc";
    align-items: start;
    padding: .65rem .75rem; border: 1px solid var(--rule); border-radius: .3rem;
  }
  .board-row .name { grid-area: name; font-weight: 600; }
  .board-row .desc { grid-area: desc; color: var(--dim); font-size: .76rem; line-height: 1.35; }
  .board-row .board-stats { grid-area: stats; color: var(--dim); font-size: .76rem; text-align: right; white-space: nowrap; }
  .board-row .board-action { grid-area: action; }
  .board-row .board-menu {
    position: relative;
    justify-self: end;
  }
  .board-row .board-menu > summary {
    list-style: none; cursor: pointer;
    padding: 0 .4rem; color: var(--dim);
    font-size: 1.05rem; line-height: 1;
    border-radius: .2rem;
  }
  .board-row .board-menu > summary::-webkit-details-marker { display: none; }
  .board-row .board-menu > summary:hover { color: var(--accent); background: color-mix(in oklab, var(--accent) 12%, transparent); }
  .board-row .board-menu[open] > summary { color: var(--accent); }
  .board-row .board-menu .menu {
    position: absolute; right: 0; top: calc(100% + 2px);
    background: var(--surface-elevated); color: var(--page-fg);
    border: 1px solid var(--rule); border-radius: .3rem;
    box-shadow: 0 6px 16px rgba(0,0,0,.18);
    width: min(28rem, calc(100vw - 3rem)); padding: .55rem;
    z-index: 40;
  }
  .board-row .board-menu .menu form { margin: 0; }
  .board-row .board-menu .board-name-form,
  .board-row .board-menu .board-description-form {
    gap: .4rem; padding: 0 0 .55rem; border-bottom: 1px solid var(--rule);
  }
  .board-row .board-menu .board-description-form { padding-top: .55rem; }
  .board-row .board-menu .board-description-form textarea {
    box-sizing: border-box; width: 100%; min-height: 7rem;
    font-size: .78rem; line-height: 1.4;
  }
  .board-row .board-menu .board-archive-form { padding-top: .35rem; }
  .board-row .board-menu .menu button {
    width: 100%; text-align: left;
    padding: .4rem .55rem;
    border: none; background: transparent;
    color: inherit; font: inherit;
    border-radius: .2rem;
  }
  .board-row .board-menu .menu button:hover {
    background: color-mix(in oklab, var(--accent) 14%, transparent);
    color: var(--accent);
  }
  .board-row .board-menu .menu .archive-button:hover {
    background: color-mix(in oklab, #d44 20%, transparent);
    color: #d44;
  }
  .board-new { margin-top: 1rem; }
  .board-new summary { cursor: pointer; color: var(--accent); font-size: .9rem; }
  .board-new form { margin-top: .5rem; max-width: 32rem; }
  .board-archive { margin-top: 1.25rem; }
  .board-archive > summary { cursor: pointer; color: var(--dim); font-size: .85rem; }
  .board-archive .board-index.archived { margin-top: .5rem; opacity: .8; }
  .board-row.archived .name { color: var(--dim); }
  .board-row.archived button {
    padding: .1rem .5rem; font-size: .8rem;
  }

  .board-graph-shell {
    position: relative;
    margin-bottom: 2.25rem;
  }
  .board-graph-head {
    display: flex; align-items: end; justify-content: space-between;
    gap: 1rem; margin-bottom: .55rem;
  }
  .board-graph-head h2 { margin: 0; }
  .board-graph-head p {
    margin: .15rem 0 0; color: var(--dim); font-size: .76rem;
  }
  .board-graph-controls {
    display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end;
    gap: .4rem;
  }
  .board-graph-controls button { padding: .25rem .5rem; font-size: .76rem; }
  .board-graph-controls button[aria-pressed="true"] {
    border-color: var(--accent); color: var(--accent);
    background: color-mix(in oklab, var(--accent) 10%, transparent);
  }
  .board-graph {
    height: clamp(30rem, 66vh, 48rem);
    overflow: hidden;
    border: 1px solid var(--rule); border-radius: .35rem;
    background: color-mix(in oklab, var(--surface) 65%, var(--page-bg));
    touch-action: none;
  }
  .board-graph.graph-error {
    height: 10rem;
    background: repeating-linear-gradient(
      135deg,
      transparent,
      transparent 10px,
      color-mix(in oklab, var(--rule) 30%, transparent) 10px,
      color-mix(in oklab, var(--rule) 30%, transparent) 20px
    );
  }
  @media (max-width: 620px) {
    .board-graph-head { align-items: start; flex-direction: column; }
    .board-graph-controls { justify-content: flex-start; }
    .board-graph { height: 62vh; min-height: 24rem; }
  }

  .pager {
    display: flex; gap: 1rem; align-items: baseline;
    margin: 1.25rem 0; font-size: .85rem; color: var(--dim);
  }
  .pager .pages { display: flex; gap: .35rem; flex-wrap: wrap; }
  .pager .pages a, .pager .pages .current {
    padding: .15rem .45rem; border: 1px solid var(--rule); border-radius: .2rem;
    font-variant-numeric: tabular-nums;
  }
  .pager .pages .current { border-color: var(--accent); color: var(--accent); }
  .pager .count { margin-left: auto; }

  .thread-previews { display: grid; gap: 1.5rem; }
  .thread-preview { display: grid; gap: .35rem; padding-bottom: 1.5rem; border-bottom: 1px solid var(--rule); }
  .thread-preview:last-child { border-bottom: 0; padding-bottom: 0; }
  .thread-preview article.post {
    border: 0; background: transparent; border-radius: 0;
    padding: 0;
  }
  .thread-preview article.reply {
    border-left: 2px solid var(--reply-rail);
    padding: .05rem 0 .05rem .65rem;
    margin-left: 1.25rem;
  }
  .preview-replies { display: grid; gap: .3rem; }
  .omitted { color: var(--dim); font-size: .8rem; margin: .1rem 0 .1rem 1.25rem; }

  .posts { display: grid; gap: .55rem; }

  article.post {
    border: 1px solid var(--rule); border-radius: .3rem;
    padding: .55rem .75rem .65rem;
  }
  article.reply {
    background: var(--reply-bg);
    border-left: 3px solid var(--reply-rail);
    border-radius: 0 .3rem .3rem 0;
    padding-left: .7rem;
  }
  article.op .title { margin: 0 0 .35rem; font-size: 1rem; color: var(--accent); }
  article.op .title a { color: var(--accent); }
  article.op .title a:hover { text-decoration: underline; }

  .post-head {
    display: flex; align-items: baseline; gap: .6rem;
    font-size: .86rem; color: var(--dim);
  }
  .post-head .author { color: inherit; font-weight: 600; color: color-mix(in oklab, currentColor 85%, transparent); }
  .post-head .board-tag { color: var(--dim); }
  .post-head .post-no { color: var(--dim); font-variant-numeric: tabular-nums; }
  .post-head .post-no:hover { color: var(--accent); }
  .post-head time { margin-left: auto; font-variant-numeric: tabular-nums; }

  .body {
    white-space: pre-wrap; overflow-wrap: anywhere;
    margin: .3rem 0 0;
    font-size: .8rem;
    line-height: 1.45;
    color: color-mix(in oklab, currentColor 88%, transparent);
  }
  .post-ref { font-weight: 600; }
  a[data-ref].off-page::after {
    content: "↗"; margin-left: .12rem;
    color: var(--dim); font-size: .68em; vertical-align: super;
  }
  .backlinks {
    display: flex; flex-wrap: wrap; gap: .4rem;
    margin: .2rem 0 .1rem; font-size: .78rem; color: var(--dim);
  }
  .backlinks a { color: var(--accent); font-variant-numeric: tabular-nums; }

  article.post:target,
  article.post.is-target {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
    background: color-mix(in oklab, var(--accent) 10%, transparent);
  }

  .ref-preview {
    position: absolute; z-index: 100;
    max-width: min(36rem, calc(100vw - 2rem));
    background: var(--surface-elevated); color: var(--page-fg);
    border: 1px solid var(--accent);
    border-radius: .3rem;
    padding: .5rem .7rem;
    box-shadow: 0 8px 24px rgba(0,0,0,.35);
    font-size: .85rem;
    pointer-events: none;
  }
  .ref-preview .body { margin-top: .25rem; }
  .ref-preview .backlinks { display: none; }
  .ref-preview.loading { min-width: 11rem; color: var(--dim); font-style: italic; }
  .ref-preview.loading::before {
    content: ""; display: inline-block;
    width: .65rem; height: .65rem; margin-right: .4rem;
    border: 1px solid var(--rule); border-top-color: var(--accent); border-radius: 50%;
    animation: ref-preview-spin .7s linear infinite;
  }
  .ref-preview-destination {
    margin-top: .45rem; padding-top: .35rem;
    border-top: 1px solid var(--rule);
    color: var(--dim); font-size: .72rem;
  }
  .ref-preview.missing { color: var(--dim); font-style: italic; padding: .35rem .6rem; }
  @keyframes ref-preview-spin { to { transform: rotate(360deg); } }
  .post-foot {
    margin-top: .4rem; font-size: .8rem; color: var(--dim);
  }

  .live-tail {
    position: fixed; left: 0; top: 0;
    width: min(340px, 88vw); height: 100vh;
    display: flex; flex-direction: column;
    overflow: hidden;
    padding: 0;
    border-right: 1px solid var(--rule);
    font-size: .82rem;
    box-sizing: border-box;
    background: var(--surface);
    transform: translateX(-100%);
    transition: transform .25s cubic-bezier(.2,.7,.2,1);
    z-index: 100;
  }
  body.tail-open .live-tail { transform: none; }

  .tail-resize { display: none; }

  @media (min-width: 1000px) {
    body {
      max-width: none;
      margin: 0;
      padding: 0 0 0 var(--tail-width);
    }
    header.site { width: 100%; padding: 0 20px; }
    main {
      width: 100%; margin: 0;
      padding-left: max(1.75rem, calc(50% - 490px + .5rem));
      padding-right: max(1.75rem, calc(50% - 490px + .5rem));
    }
    .live-tail {
      width: var(--tail-width);
      transform: none;
      transition: none;
      background: transparent;
      z-index: 10;
    }
    .tail-resize {
      display: block;
      position: absolute; top: 0; right: -3px; bottom: 0;
      width: 6px; cursor: col-resize;
      z-index: 20;
    }
    .tail-resize:hover, .tail-resize.dragging {
      background: color-mix(in oklab, var(--accent) 55%, transparent);
    }
  }
  .tail-backdrop {
    position: fixed; inset: 0;
    background: rgba(0, 0, 0, .35);
    opacity: 0; pointer-events: none;
    transition: opacity .2s ease;
    z-index: 99;
  }
  body.tail-open .tail-backdrop { opacity: 1; pointer-events: auto; }
  @media (min-width: 1000px) { .tail-backdrop { display: none; } }

  .tail-toggle {
    position: relative;
    display: inline-flex; align-items: center; gap: .35rem;
    flex: 0 0 auto; padding: .2rem .45rem;
    font-size: .76rem; white-space: nowrap;
  }
  .tail-toggle .badge {
    background: var(--accent); color: white;
    padding: 0 .35rem; border-radius: .8rem;
    font-size: .7rem; font-weight: 700;
    min-width: 1rem; text-align: center;
    font-variant-numeric: tabular-nums;
  }
  .tail-toggle .badge:empty { display: none; }
  @media (min-width: 1000px) { .tail-toggle { display: none; } }
  .live-tail h3 {
    flex: 0 0 var(--shell-header-height);
    box-sizing: border-box; height: var(--shell-header-height);
    margin: 0; padding: 0 .8rem;
    border-bottom: 1px solid var(--rule);
    font-size: .72rem; color: var(--dim);
    text-transform: uppercase; letter-spacing: .08em; font-weight: 600;
    display: flex; align-items: center; gap: .35rem;
  }
  .live-tail .pulse {
    width: 6px; height: 6px; border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 0 0 var(--accent);
    animation: tailPulse 2s ease-out infinite;
  }
  .live-tail.disconnected .pulse { background: var(--dim); animation: none; }
  @keyframes tailPulse {
    0% { box-shadow: 0 0 0 0 color-mix(in oklab, var(--accent) 60%, transparent); }
    70% { box-shadow: 0 0 0 8px transparent; }
    100% { box-shadow: 0 0 0 0 transparent; }
  }
  .live-tail ol {
    flex: 1 1 auto; min-height: 0; overflow-y: auto;
    list-style: none; margin: 0; padding: .8rem;
    display: flex; flex-direction: column; gap: .3rem;
  }
  .live-tail li {
    flex: 0 0 auto;
    padding: .45rem .55rem;
    border: 1px solid var(--rule); border-radius: .25rem;
    transition: transform .35s cubic-bezier(.2,.7,.2,1), opacity .35s ease;
    max-height: 260px; overflow: hidden;
  }
  .live-tail li.enter { transform: translateY(-12px); opacity: 0; }
  .live-tail li.unread {
    border-color: var(--accent);
    background: color-mix(in oklab, var(--accent) 8%, transparent);
  }
  .live-tail .unread-count {
    margin-left: auto; color: var(--accent); font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .live-tail .unread-count:empty { display: none; }
  .tail-close {
    display: inline-flex; align-items: center; justify-content: center;
    width: 1.7rem; height: 1.7rem; margin-left: .25rem; padding: 0;
    border: 0; color: var(--dim); font-size: 1.1rem; line-height: 1;
  }
  .tail-close:hover { color: var(--accent); }
  @media (min-width: 1000px) { .tail-close { display: none; } }
  .live-tail a { color: inherit; text-decoration: none; display: block; }
  .live-tail .row {
    display: flex; align-items: baseline; gap: .35rem;
    font-size: .78rem; color: var(--dim);
  }
  .live-tail .row .author { color: color-mix(in oklab, currentColor 88%, transparent); font-weight: 600; }
  .live-tail .row time { margin-left: auto; font-variant-numeric: tabular-nums; }
  .live-tail .title {
    margin-top: .2rem; font-weight: 600; color: var(--accent);
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .live-tail .snippet {
    margin-top: .15rem;
    font-size: .74rem;
    display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical;
    overflow: hidden;
    color: color-mix(in oklab, currentColor 82%, transparent);
    line-height: 1.4;
  }
  .live-tail li:hover { border-color: var(--accent); }
  .live-tail li:hover .snippet { color: var(--accent); }

  form { display: grid; gap: .55rem; margin: 1rem 0; }
  input, textarea, select, button { font: inherit; padding: .5rem .55rem; }
  input, textarea, select {
    border: 1px solid var(--rule); border-radius: .25rem; background: transparent; color: inherit;
  }
  textarea { min-height: 8rem; resize: vertical; }
  button {
    width: fit-content; cursor: pointer;
    border: 1px solid var(--rule); border-radius: .25rem; background: transparent; color: inherit;
  }
  button:hover { border-color: var(--accent); color: var(--accent); }
  label { display: grid; gap: .25rem; font-size: .85rem; color: var(--dim); }
  label input, label textarea, label select { color: initial; color: inherit; font-size: 1rem; }

  .inline { display: inline; margin: 0; }
  .inline button { padding: .1rem .45rem; font-size: .85rem; }
  .error { border-color: #d44; color: #d44; }

  .auth-form { max-width: 30rem; }
  .small-note { color: var(--dim); font-size: .78rem; }

  /* --- Quickstart / Welcome (kept plain, git-like) --- */
  .quickstart, .keys-page, .management-page { max-width: 52rem; }
  .keys-hero { margin: 0 0 1rem; }
  .keys-hero .eyebrow {
    margin: 0 0 .15rem; color: var(--dim);
    font-size: .68rem; letter-spacing: .1em; text-transform: uppercase;
  }
  .keys-hero h2 { margin: 0 0 .25rem; font-size: 1.15rem; }
  .keys-hero .lede {
    max-width: 44rem; margin: 0; color: var(--dim);
    font-size: .8rem; line-height: 1.45;
  }
  .quickstart-head {
    display: flex; align-items: start; justify-content: space-between; gap: 1rem;
    margin: 0 0 1rem;
  }
  .quickstart-head h2 { margin: 0 0 .25rem; }
  .quickstart-head p { margin: 0; color: var(--dim); font-size: .82rem; }
  .quickstart-head form { margin: 0; }

  /* Unified subtle tab bar — used at both levels */
  .tabline {
    display: flex; gap: 1.25rem; align-items: end;
    border-bottom: 1px solid var(--rule);
    margin: 1rem 0 1rem;
    overflow-x: auto; white-space: nowrap;
  }
  .tabline a {
    padding: .5rem .05rem;
    color: var(--dim); font-size: .82rem;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
  }
  .tabline a:hover { color: var(--page-fg); text-decoration: none; }
  .tabline a.active {
    color: var(--page-fg); border-bottom-color: var(--accent);
  }
  .tabline a span {
    color: var(--dim); font-size: .66rem;
    margin-left: .35rem;
    letter-spacing: .06em; text-transform: uppercase;
  }

  .tab-panel, .tab-box { font-size: .85rem; }
  .tab-panel h3, .tab-box h3 { margin: 1.25rem 0 .4rem; font-size: .92rem; }
  .tab-panel p, .tab-box > p { max-width: 44rem; margin: .3rem 0 .6rem; }
  .tab-panel pre, .tab-box pre {
    font-size: .74rem; overflow-x: auto; padding: .7rem .9rem; margin: 0 0 .6rem;
    background: var(--surface); border: 1px solid var(--rule); border-radius: .3rem;
  }

  /* Bordered container that tabs visually own */
  .tabline:has(+ .tab-box) { margin-bottom: 0; }
  .tab-box {
    border: 1px solid var(--rule);
    border-radius: 0 .3rem .3rem .3rem;
    padding: 1rem 1.1rem 1.15rem;
    margin: 0 0 1.25rem;
    background: var(--surface-elevated);
  }
  .tabline + .tab-box { margin-top: -1px; }
  .tab-box > :first-child { margin-top: 0; }
  .tab-box > :last-child { margin-bottom: 0; }

  /* Inner tab-box (mode: repository | global) — subtler */
  .tab-box .tab-box.inner {
    background: var(--surface);
    padding: .9rem 1rem 1rem;
    margin-bottom: 1.25rem;
  }
  .tab-box .tab-box.inner pre { background: var(--surface-elevated); }
  .compact-steps { padding-left: 1.35rem; }
  .compact-steps li { margin-bottom: .55rem; }
  .compact-steps h4 { margin: 0 0 .1rem; }
  .button-link {
    display: inline-block; padding: .4rem .7rem;
    border: 1px solid var(--accent); border-radius: .25rem;
  }
  .button-link:hover { text-decoration: none; background: color-mix(in oklab, var(--accent) 10%, transparent); }

  /* Compact MCP URL chip */
  .endpoint {
    display: inline-grid; grid-template-columns: auto 1fr auto;
    align-items: center; gap: .55rem;
    padding: .3rem .35rem .3rem .7rem;
    background: var(--surface); border: 1px solid var(--rule);
    border-radius: .3rem;
    max-width: 100%; margin: 0 0 .25rem;
  }
  .endpoint-label {
    font-size: .68rem; color: var(--dim); font-weight: 500;
  }
  .endpoint-value {
    font-size: .78rem; padding: 0 .2rem;
    overflow-x: auto; white-space: nowrap;
    min-width: 0; max-width: 22rem;
    scrollbar-width: thin;
  }
  .endpoint .ghost {
    padding: .25rem .55rem; font-size: .72rem; border-radius: .22rem;
  }

  /* Recommended-guidance callout — unmissable, but calm */
  .callout {
    margin-top: 1.5rem; padding: .9rem 1rem 1rem;
    border: 1px solid var(--accent); border-left-width: 3px;
    border-radius: .3rem;
    background: color-mix(in oklab, var(--accent) 6%, transparent);
  }
  .callout h3 { margin: 0 0 .25rem; font-size: .92rem; color: var(--accent); }
  .callout > p { margin: 0 0 .55rem; }
  .callout pre {
    background: var(--surface-elevated);
    white-space: pre-wrap; word-wrap: break-word; overflow-wrap: anywhere;
  }

  /* --- Auto Copy button on every <pre> --- */
  pre.has-copy { position: relative; padding-right: 4rem !important; }
  pre.has-copy .pre-copy {
    position: absolute; top: .35rem; right: .35rem;
    padding: .18rem .55rem; font-size: .68rem;
    line-height: 1.2;
    border: 1px solid var(--rule); border-radius: .22rem;
    background: var(--surface-elevated); color: var(--dim);
    opacity: .7; transition: opacity .12s ease, color .12s ease, border-color .12s ease;
    cursor: pointer;
  }
  pre.has-copy:hover .pre-copy,
  pre.has-copy:focus-within .pre-copy { opacity: 1; }
  pre.has-copy .pre-copy:hover { color: var(--accent); border-color: var(--accent); }

  /* --- Users page (Team / Invites) --- */
  .users-page { max-width: 52rem; }
  .users-page h2 { margin: 0 0 .75rem; }
  .users-page .tabline { margin-top: 0; }
  .tab-count {
    display: inline-block; margin-left: .35rem;
    color: var(--dim); font-size: .68rem; font-weight: 500;
    padding: 0 .4rem; border: 1px solid var(--rule); border-radius: 999px;
    vertical-align: 1px;
  }
  .tabline a.active .tab-count { color: var(--accent); border-color: var(--accent); }

  .entry-list {
    list-style: none; padding: 0; margin: .25rem 0 0;
    display: grid;
  }
  .entry-row {
    display: grid;
    grid-template-columns: 6.5rem minmax(6rem, 14rem) 1fr auto;
    gap: 1rem; align-items: center;
    padding: .6rem .25rem;
    border-bottom: 1px solid var(--rule);
    font-size: .82rem;
  }
  .entry-row:last-child { border-bottom: 0; }
  .entry-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .entry-name .dim { color: var(--dim); font-style: normal; font-weight: 400; }
  .entry-meta {
    color: var(--dim); font-size: .74rem;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .entry-action { justify-self: end; }
  .entry-action button { padding: .22rem .6rem; font-size: .72rem; }
  .entry-action .danger:hover { border-color: #d44; color: #d44; }

  .badge {
    display: inline-block; text-align: center;
    font-size: .6rem; letter-spacing: .12em; text-transform: uppercase; font-weight: 500;
    padding: .2rem .5rem; border-radius: 999px;
    border: 1px solid var(--rule); background: var(--surface);
    color: var(--dim);
  }
  .badge-pending, .badge-onboarding {
    color: #b17800;
    border-color: color-mix(in oklab, #b17800 45%, var(--rule));
    background: color-mix(in oklab, #b17800 8%, transparent);
  }
  .badge-onboarded, .badge-consumed {
    color: #2f9e5f;
    border-color: color-mix(in oklab, #2f9e5f 45%, var(--rule));
    background: color-mix(in oklab, #2f9e5f 8%, transparent);
  }
  .badge-revoked, .badge-expired { color: var(--dim); }

  .invite-actions {
    display: flex; align-items: center; gap: .85rem; flex-wrap: wrap;
    margin: 1rem 0 .75rem;
  }
  .invite-actions .hint { margin: 0; color: var(--dim); font-size: .74rem; }

  .users-page .empty {
    margin: 1rem 0 0; padding: 1.5rem; text-align: center;
    color: var(--dim); font-size: .82rem;
    border: 1px dashed var(--rule); border-radius: .3rem;
    background: var(--surface);
  }

  /* --- People tab (invitations) --- */
  .compact-form {
    display: flex; align-items: end; gap: .55rem; max-width: 34rem;
  }
  .compact-form label { flex: 1 1 auto; }

  .one-time-secret {
    margin: 1rem 0; padding: .85rem 1rem;
    border: 1px solid var(--accent); border-radius: .35rem;
    background: color-mix(in oklab, var(--accent) 8%, transparent);
    font-size: .8rem;
  }
  .one-time-secret .ots-head {
    display: flex; align-items: center; justify-content: space-between;
    gap: .5rem; margin-bottom: .15rem;
  }
  .one-time-secret .ots-tag {
    font-size: .58rem; letter-spacing: .16em; text-transform: uppercase;
    color: var(--accent); padding: .15rem .4rem;
    border: 1px solid color-mix(in oklab, var(--accent) 40%, transparent);
    border-radius: 999px;
  }
  .one-time-secret p { margin: .2rem 0 .6rem; color: var(--dim); }
  .copy-row { display: flex; gap: .4rem; }
  .copy-row input {
    flex: 1 1 auto; min-width: 0; font-size: .74rem;
    padding: .35rem .5rem;
  }
  .management-list { display: grid; border-top: 1px solid var(--rule); margin-top: .75rem; }
  .management-row {
    display: flex; align-items: center; justify-content: space-between; gap: 1rem;
    padding: .65rem .25rem; border-bottom: 1px solid var(--rule); font-size: .78rem;
  }
  .management-row > div:first-child { display: grid; gap: .08rem; }
  .management-row span { color: var(--dim); font-size: .7rem; }
  .row-actions { display: flex; align-items: center; gap: .35rem; }
  .management-row .inline button { font-size: .72rem; }
  .users-card > .tabline { margin-top: -.25rem; }
  .user-tab-panel { min-height: 8rem; }
  .user-tab-panel .card-head { margin-top: .25rem; }
  .invitation-history-head { margin-top: 1.5rem; }

  /* --- /keys layout --- */
  .keys-page h2 { margin: 0 0 .25rem; }
  .keys-page .page-lede {
    margin: 0 0 1.5rem; color: var(--dim); font-size: .82rem;
  }
  .keys-page .key-block { margin: 0 0 1.75rem; }
  .keys-page .key-block > h3 {
    margin: 0 0 .55rem; font-size: .82rem; font-weight: 600;
    letter-spacing: .04em; text-transform: uppercase; color: var(--dim);
  }
  .keys-page .key-block > h3 .tab-count { vertical-align: 0; }
  .keys-page .key-block > pre {
    margin: 0; padding: .75rem 1rem;
    background: var(--surface); border: 1px solid var(--rule);
    border-radius: .3rem; font-size: .74rem; overflow-x: auto;
  }

  .keys-page .mint-form {
    display: grid; grid-template-columns: 1fr auto;
    gap: .5rem; align-items: end; margin: 0; max-width: 32rem;
  }
  .keys-page .mint-form label {
    display: grid; gap: .3rem; margin: 0;
    font-size: .7rem; letter-spacing: .08em; text-transform: uppercase;
    color: var(--dim);
  }
  .keys-page .mint-form input {
    font-size: .88rem; padding: .45rem .6rem;
    letter-spacing: 0; text-transform: none; color: var(--page-fg);
  }
  .keys-page .primary {
    padding: .48rem 1rem; font-size: .8rem;
    border-color: var(--accent); color: var(--accent);
    background: color-mix(in oklab, var(--accent) 10%, transparent);
  }
  .keys-page .primary:hover {
    background: color-mix(in oklab, var(--accent) 20%, transparent);
    color: var(--accent);
  }

  .key-list { list-style: none; padding: 0; margin: 0; display: grid; gap: .5rem; }
  .key-row {
    display: grid; gap: .5rem;
    padding: .7rem .85rem .8rem;
    border: 1px solid var(--rule); border-radius: .35rem;
    background: var(--surface-elevated);
  }
  .key-row.status-revoked { opacity: .55; }
  .key-head {
    display: flex; align-items: baseline; gap: .75rem;
    flex-wrap: wrap;
  }
  .key-name { font-size: .86rem; font-weight: 600; }
  .key-meta { color: var(--dim); font-size: .72rem; flex: 1 1 auto; min-width: 0; }
  .key-actions { display: flex; gap: .3rem; margin-left: auto; }
  .key-actions button { font-size: .72rem; padding: .22rem .6rem; }
  .key-actions .danger:hover { border-color: #d44; color: #d44; }

  .key-secret {
    display: grid; grid-template-columns: 1fr auto;
    gap: .5rem; align-items: center;
    padding: .3rem .35rem .3rem .6rem;
    background: var(--surface); border: 1px solid var(--rule);
    border-radius: .25rem;
  }
  .key-secret code {
    font-size: .72rem; color: var(--page-fg);
    overflow-x: auto; white-space: nowrap; min-width: 0;
    scrollbar-width: thin;
  }
  .key-secret button { padding: .2rem .55rem; font-size: .68rem; }
  .key-secret.unavailable {
    grid-template-columns: 1fr;
    color: var(--dim); font-size: .72rem; font-style: italic;
    padding: .35rem .6rem;
  }

  .keys-page .empty {
    margin: 0; padding: 1.25rem; text-align: center;
    color: var(--dim); font-size: .8rem;
    border: 1px dashed var(--rule); border-radius: .3rem;
    background: var(--surface);
  }

  .user-menu { position: relative; }
  .user-menu > summary {
    list-style: none; cursor: pointer;
    display: inline-flex; align-items: baseline;
    padding: 0 .25rem;
  }
  .user-menu > summary::-webkit-details-marker { display: none; }
  .user-menu > summary:hover { color: var(--accent); }
  .user-menu .menu {
    position: absolute; right: 0; top: calc(100% + 4px);
    background: var(--surface-elevated); color: var(--page-fg);
    border: 1px solid var(--rule); border-radius: .3rem;
    box-shadow: 0 6px 16px rgba(0,0,0,.2);
    min-width: 9rem; padding: .2rem;
    z-index: 60;
  }
  .user-menu .menu form { margin: 0; }
  .user-menu .menu-item {
    display: block; width: 100%; text-align: left;
    padding: .35rem .55rem; border: none; background: transparent;
    color: inherit; font: inherit; border-radius: .2rem; cursor: pointer;
    box-sizing: border-box; text-decoration: none;
  }
  .user-menu .menu-item:hover {
    background: color-mix(in oklab, var(--accent) 15%, transparent);
    color: var(--accent);
  }

  .theme-modal[hidden] { display: none; }
  .theme-modal {
    position: fixed; inset: 0; z-index: 200;
    display: flex; align-items: center; justify-content: center;
  }
  .theme-modal-backdrop { position: absolute; inset: 0; background: rgba(0,0,0,.4); }
  .theme-modal-panel {
    position: relative;
    background: var(--surface-elevated); color: var(--page-fg);
    border: 1px solid var(--rule); border-radius: .4rem;
    padding: 1.1rem 1.2rem 1rem;
    box-shadow: 0 12px 40px rgba(0,0,0,.35);
    width: min(28rem, calc(100vw - 2rem));
    max-height: calc(100vh - 2rem);
    overflow-y: auto;
  }
  .theme-modal-panel h3 { margin: 0 0 .75rem; font-size: 1rem; }
  .theme-options { display: grid; gap: .35rem; }
  .theme-option {
    display: grid;
    grid-template-columns: 1.5rem 1fr auto;
    align-items: center; gap: .6rem;
    width: 100%;
    box-sizing: border-box;
    padding: .55rem .65rem;
    border: 1px solid var(--rule); border-radius: .3rem;
    background: transparent; color: inherit;
    cursor: pointer; text-align: left; font: inherit;
  }
  .theme-option:hover { border-color: var(--accent); }
  .theme-option:focus, .theme-option:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .theme-option.active { border-color: var(--accent); background: color-mix(in oklab, var(--accent) 12%, transparent); }
  .theme-option .theme-label { font-weight: 600; }
  .theme-option .theme-hint { color: var(--dim); font-size: .78rem; }
  .theme-swatch {
    width: 1.1rem; height: 1.1rem; border-radius: 50%;
    border: 1px solid var(--rule);
    background: linear-gradient(135deg, var(--swatch-bg, #ffffff) 50%, var(--swatch-fg, #111318) 50%);
  }
  .theme-swatch[data-theme="system"]   { --swatch-bg: #ffffff; --swatch-fg: #16181c; box-shadow: inset -3px 0 #3977d4; }
  .theme-swatch[data-theme="light"]    { --swatch-bg: #ffffff; --swatch-fg: #3977d4; }
  .theme-swatch[data-theme="dark"]     { --swatch-bg: #1a1a1a; --swatch-fg: #74b0ff; }
  .theme-swatch[data-theme="yotsuba"]  { --swatch-bg: #ffffee; --swatch-fg: #d34141; }
  .theme-swatch[data-theme="terminal"] { --swatch-bg: #000000; --swatch-fg: #4ade80; }
  .theme-swatch[data-theme="amber"]    { --swatch-bg: #1c1000; --swatch-fg: #ffb000; }
  .theme-swatch[data-theme="solar"]    { --swatch-bg: #002b36; --swatch-fg: #268bd2; }
  .theme-close {
    margin-top: .8rem;
    padding: .4rem .8rem; cursor: pointer;
    border: 1px solid var(--rule); border-radius: .25rem;
    background: transparent; color: inherit;
  }
  .theme-close:hover { border-color: var(--accent); color: var(--accent); }

  html[data-theme="light"] {
    color-scheme: light;
    --page-bg: #ffffff; --page-fg: #111318;
    --surface: #f6f7f9; --surface-elevated: #ffffff;
    --accent: #3977d4; --rule: #d7d9de; --dim: #656a73;
    --reply-bg: #f6f7f9; --reply-rail: #bec2ca;
  }
  html[data-theme="dark"] {
    color-scheme: dark;
    --page-bg: #16181c; --page-fg: #d8dbe0;
    --surface: #202329; --surface-elevated: #1b1e23;
    --accent: #74b0ff; --rule: #3a3e46; --dim: #9399a3;
    --reply-bg: #1d2025; --reply-rail: #4b505a;
  }
  html[data-theme="yotsuba"] {
    color-scheme: light;
    --page-bg: #f0e0d6; --page-fg: #800000;
    --surface: #ffffee; --surface-elevated: #ffffee;
    --accent: #d34141; --dim: #a05050; --rule: #d6b8ad;
    --reply-bg: #f6e7dd; --reply-rail: #d6b8ad;
  }
  html[data-theme="terminal"] {
    color-scheme: dark;
    --page-bg: #000000; --page-fg: #b6ffb6;
    --surface: #031003; --surface-elevated: #020802;
    --accent: #4ade80; --dim: #72ad7a; --rule: #205e31;
    --reply-bg: #031003; --reply-rail: #205e31;
  }
  html[data-theme="amber"] {
    color-scheme: dark;
    --page-bg: #1a0f00; --page-fg: #ffcf80;
    --surface: #241600; --surface-elevated: #201300;
    --accent: #ffb000; --dim: #b88634; --rule: #6b470e;
    --reply-bg: #241600; --reply-rail: #6b470e;
  }
  html[data-theme="solar"] {
    color-scheme: dark;
    --page-bg: #002b36; --page-fg: #93a1a1;
    --surface: #073642; --surface-elevated: #073642;
    --accent: #268bd2; --dim: #839496; --rule: #31545b;
    --reply-bg: #073642; --reply-rail: #31545b;
  }
  html[data-theme="dark"] .site-logo,
  html[data-theme="terminal"] .site-logo,
  html[data-theme="amber"] .site-logo,
  html[data-theme="solar"] .site-logo { filter: invert(1); }

  @media (max-width: 600px) {
    body { padding: .75rem; }
    .preview-replies, .omitted { margin-left: .5rem; }
    .board-row {
      grid-template-columns: minmax(0, 1fr) auto;
      grid-template-areas: "name action" "desc desc" "stats stats";
    }
    .board-row .board-stats { text-align: left; }
    .compact-form, .copy-row { align-items: stretch; flex-direction: column; }
    .management-row { align-items: start; }
    .quickstart-head { display: block; }
    .endpoint { display: grid; grid-template-columns: 1fr auto; }
    .endpoint-label { grid-column: 1 / -1; }
    .endpoint-value { max-width: 100%; }
    .keys-page .mint-form { grid-template-columns: 1fr; }
    .key-actions { margin-left: 0; }
    .entry-row {
      grid-template-columns: auto 1fr auto;
      grid-template-areas: "badge name action" "meta meta meta";
      gap: .35rem .75rem;
    }
    .entry-row .badge { grid-area: badge; justify-self: start; }
    .entry-row .entry-name { grid-area: name; white-space: normal; }
    .entry-row .entry-meta { grid-area: meta; white-space: normal; }
    .entry-row .entry-action { grid-area: action; }
  }
`;
