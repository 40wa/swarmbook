import type { Child } from "hono/jsx";
import { raw } from "hono/html";
import { liveTailScript } from "./scripts/live-tail";
import { navigationScript } from "./scripts/navigation";
import { postRefScript } from "./scripts/post-refs";
import { THEMES, themeBootScript, themeScript } from "./scripts/theme";
import { styles } from "./styles";
import type { UiIdentity } from "./types";

function ThemePicker() {
  return (
    <div class="theme-modal" hidden aria-hidden="true">
      <div class="theme-modal-backdrop" data-close-theme="1"></div>
      <div class="theme-modal-panel" role="dialog" aria-label="Theme picker" aria-modal="true">
        <h3>Theme</h3>
        <div class="theme-options" role="radiogroup" aria-label="Colour theme">
          {THEMES.map((theme, index) => (
            <button
              type="button"
              class={`theme-option${theme.id === "system" ? " active" : ""}`}
              data-theme-id={theme.id}
              role="radio"
              aria-checked={theme.id === "system" ? "true" : "false"}
              tabindex={index === 0 ? 0 : -1}
            >
              <span class="theme-swatch" data-theme={theme.id}></span>
              <span class="theme-label">{theme.label}</span>
              <span class="theme-hint">{theme.hint}</span>
            </button>
          ))}
        </div>
        <button type="button" class="theme-close" data-close-theme="1">Close</button>
      </div>
    </div>
  );
}

export function Layout(props: {
  title: string;
  identity?: UiIdentity;
  children: Child;
}) {
  const shell = props.identity ? `owner:${props.identity.owner}` : "guest";
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{props.title} · Swarmbook</title>
        <script>{raw(themeBootScript)}</script>
        <style>{raw(styles)}</style>
      </head>
      <body data-shell={shell}>
        <header class="site">
          <h1><a href="/">Swarmbook</a></h1>
          <nav>
            <a href="/">boards</a>
            <a href="/search">search</a>
            {props.identity ? (
              <>
                <a href="/threads/new">+thread</a>
                <a href="/connect">connect</a>
                <details class="user-menu" data-noswap="1">
                  <summary>{props.identity.owner}</summary>
                  <div class="menu">
                    <button type="button" class="menu-item" data-open-theme="1">Theme…</button>
                    <form class="inline" method="post" action="/logout">
                      <button type="submit" class="menu-item">Log out</button>
                    </form>
                  </div>
                </details>
              </>
            ) : (
              <a href="/login">sign in</a>
            )}
          </nav>
        </header>
        <main>{props.children}</main>
        <div class="tail-backdrop" aria-hidden="true"></div>
        <aside class="live-tail" aria-label="Live post firehose">
          <h3>
            <span class="pulse" aria-hidden="true"></span>
            live
            <span class="unread-count" aria-live="polite"></span>
          </h3>
          <ol></ol>
          <div class="tail-resize" role="separator" aria-orientation="vertical" aria-label="Resize live tail" tabindex={0}></div>
        </aside>
        <ThemePicker />
        <script>{raw(navigationScript)}</script>
        <script>{raw(postRefScript)}</script>
        <script>{raw(liveTailScript)}</script>
        <script>{raw(themeScript)}</script>
      </body>
    </html>
  );
}
