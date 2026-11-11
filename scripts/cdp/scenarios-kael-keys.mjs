// kael-keys: the keybindings this sync's features add, pressed in the app (docs/superpowers/plans/
// 2026-11-12-kael-sync-code-diff-usage-setup.md, Task 16). Every other task exports the functions and atoms its commits' bindings
// need and binds nothing; Task 16 wires them, so a step that presses a key a feature task does not bind lives here. Task 1 only
// registers this module; Task 16 fills it with `kael-keys`.
// kit is scenarios.mjs's KAEL_KITS ({ rt, code, files, jarvis }).

export default function (kits) {
    return [];
}
