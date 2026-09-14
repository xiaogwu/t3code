# Appearance and Themes

Read this before changing themes, fonts, motion, or publishing a theme to a
server's clients.

## Per-device Preferences

**Settings → Appearance** on web and desktop picks a theme and whether to follow
the system's light/dark setting; select the light and dark previews inside a theme
to use different ones per mode. These preferences are saved per device or browser,
so changing them on one client does not move the others. Mobile keeps its own
themes and text, code, and terminal preferences, and does not follow environment
themes.

**Panel animations** is 0 ms by default — sidebar, right panel, and terminal drawer
open instantly. Raising it up to 400 ms adds motion, unless the OS asks for reduced
motion. Do not raise it on the user's behalf just to make a change feel smoother.

**Create theme** opens the editor for adjusting a palette or importing a T3 Code or
VS Code theme, and exports JSON for sharing. The editor's color picker can sample a
region of the app to find which color to change — the fastest way to answer "what
is this color called".

## Publishing an Environment Theme

An environment can publish themes to the clients it serves. This covers the server
serving the web app and the desktop app's main local environment;
app.t3.codes and additional connections do not use them.

1. Save a theme JSON into `~/.t3/userdata/themes/` on that machine (or the `themes`
   directory of a custom state directory). **The filename is the theme ID**:
   `nightfall.json` is `nightfall`.
2. Do not use `system`, `light`, `dark`, or a built-in theme's ID.
3. Write to a temporary file in that directory and rename it into place, so a
   client never reads a partial theme. Invalid files are not published.
4. Keep the filename stable when updating colors — clients follow the ID.

A full export from the theme editor works, and so does this shorter generated
form:

```json
{
  "name": "Nightfall",
  "appearance": "dark",
  "canvas": "#1a1b26",
  "accent": "#7aa2f7",
  "colors": {
    "terminalSelection": "#292e42",
    "error": "#f7768e"
  }
}
```

`appearance` is `light` or `dark`; `canvas` and `accent` are hex; T3 Code generates
the rest. Optional `colors` keys use the names from the theme editor's advanced
view.

## Setting the Default

Run on the server:

```bash
t3 theme set nightfall     # Switch connected clients to it
t3 theme show              # Current default and published themes
t3 theme clear             # Drop the default, leave everyone's current theme alone
```

Each client applies the setting once, and a user who picks something else
afterwards keeps their choice until the next `t3 theme set` — rerun the command,
even with an unchanged name, to reapply. Offline clients apply it when they
reconnect. A saved custom theme with the same ID wins over the published one, and
if the server stops publishing the selected theme, clients fall back to the
standard theme.

In **Settings → Appearance**, selecting a published theme follows the server as it
updates the palette; **Duplicate** makes an independent copy to edit.

Further reading: [appearance and themes](https://github.com/pingdotgg/t3code/blob/main/docs/user/appearance.md).
