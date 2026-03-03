"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const cp = __importStar(require("child_process"));
const os = __importStar(require("os"));
const fs = __importStar(require("fs"));
// ---------------------------------------------------------------------------
// Resolve the bundled default sound packaged with the extension
// ---------------------------------------------------------------------------
function getBundledSoundPath(extensionPath) {
    const bundled = `${extensionPath}/media/error.mp3`;
    return fs.existsSync(bundled) ? bundled : '';
}
// ---------------------------------------------------------------------------
// Cross-platform audio playback
// ---------------------------------------------------------------------------
function playSound(soundPath) {
    if (!soundPath) {
        vscode.window.showWarningMessage('Faaah: No sound file found. Set a custom path via "faaah.soundFile" in settings.');
        return;
    }
    if (!fs.existsSync(soundPath)) {
        vscode.window.showWarningMessage(`Faaah: Sound file not found: ${soundPath}`);
        return;
    }
    const platform = os.platform();
    try {
        if (platform === 'darwin') {
            cp.spawn('afplay', [soundPath], { detached: true, stdio: 'ignore' }).unref();
        }
        else if (platform === 'win32') {
            // Use PowerShell's SoundPlayer for .wav; fall back to Media.player for others
            const script = `Add-Type -AssemblyName presentationCore; $player = New-Object System.Windows.Media.MediaPlayer; $player.Open([uri]'${soundPath}'); $player.Play(); Start-Sleep -Milliseconds 3000`;
            cp.spawn('powershell', ['-NonInteractive', '-Command', script], {
                detached: true,
                stdio: 'ignore',
            }).unref();
        }
        else {
            // Try common Linux CLI players in order
            for (const player of ['paplay', 'aplay', 'ffplay', 'mplayer']) {
                const result = cp.spawnSync('which', [player]);
                if (result.status === 0) {
                    const args = player === 'ffplay'
                        ? ['-nodisp', '-autoexit', soundPath]
                        : [soundPath];
                    cp.spawn(player, args, { detached: true, stdio: 'ignore' }).unref();
                    return;
                }
            }
            vscode.window.showWarningMessage('Faaah: No audio player found on Linux. Install paplay, aplay, ffplay, or mplayer.');
        }
    }
    catch (err) {
        console.error('Faaah: error playing sound', err);
    }
}
// ---------------------------------------------------------------------------
// Extension activation
// ---------------------------------------------------------------------------
function activate(context) {
    const log = vscode.window.createOutputChannel('Faaah');
    log.appendLine('Faaah activated. Extension path: ' + context.extensionPath);
    log.show(true); // auto-open so user can see it
    vscode.window.showInformationMessage('Faaah is active ✓');
    let previousErrorCount = getTotalErrorCount();
    let debounceTimer;
    // ------------------------------------------------------------------
    // Helper: resolve the sound path from settings → bundled default
    // ------------------------------------------------------------------
    function resolveSoundPath() {
        const config = vscode.workspace.getConfiguration('faaah');
        const custom = config.get('soundFile', '').trim();
        if (custom !== '') {
            log.appendLine('Using custom sound: ' + custom);
            return custom;
        }
        const bundled = getBundledSoundPath(context.extensionPath);
        log.appendLine('Using bundled sound: ' + bundled);
        return bundled;
    }
    // ------------------------------------------------------------------
    // Helper: debounced trigger
    // ------------------------------------------------------------------
    function triggerSound(reason) {
        const config = vscode.workspace.getConfiguration('faaah');
        if (!config.get('enabled', true)) {
            log.appendLine('Sound disabled, skipping. Reason: ' + reason);
            return;
        }
        const delay = config.get('debounceMs', 500);
        log.appendLine(`Trigger: ${reason} — playing in ${delay}ms`);
        if (debounceTimer !== undefined) {
            clearTimeout(debounceTimer);
        }
        debounceTimer = setTimeout(() => {
            const soundPath = resolveSoundPath();
            log.appendLine('Playing: ' + soundPath);
            playSound(soundPath);
            debounceTimer = undefined;
        }, delay);
    }
    // ------------------------------------------------------------------
    // 1. Watch the Problems panel (diagnostics) for NEW errors
    // ------------------------------------------------------------------
    const diagListener = vscode.languages.onDidChangeDiagnostics(() => {
        const currentErrorCount = getTotalErrorCount();
        if (currentErrorCount > previousErrorCount) {
            triggerSound(`diagnostics error count ${previousErrorCount} → ${currentErrorCount}`);
        }
        previousErrorCount = currentErrorCount;
    });
    // ------------------------------------------------------------------
    // 2a. Shell integration: fires per-command when shell integration active
    // ------------------------------------------------------------------
    const shellExecListener = vscode.window.onDidEndTerminalShellExecution(event => {
        log.appendLine(`onDidEndTerminalShellExecution exitCode=${event.exitCode}`);
        if (event.exitCode !== undefined && event.exitCode !== 0) {
            triggerSound(`terminal command exited with ${event.exitCode}`);
        }
    });
    // ------------------------------------------------------------------
    // 2b. Fallback: fires when a terminal is closed (no shell integration)
    // ------------------------------------------------------------------
    const closeListener = vscode.window.onDidCloseTerminal(terminal => {
        const exitCode = terminal.exitStatus?.code;
        log.appendLine(`onDidCloseTerminal exitCode=${exitCode}`);
        if (exitCode !== undefined && exitCode !== 0) {
            triggerSound(`terminal closed with exit code ${exitCode}`);
        }
    });
    // ------------------------------------------------------------------
    // 3. "Test Sound" command
    // ------------------------------------------------------------------
    const testCommand = vscode.commands.registerCommand('faaah.testSound', () => {
        const soundPath = resolveSoundPath();
        if (!soundPath) {
            vscode.window.showErrorMessage('Faaah: No sound file available. Configure "faaah.soundFile" in settings.');
            return;
        }
        log.appendLine('Test command: playing ' + soundPath);
        log.show(true);
        playSound(soundPath);
    });
    context.subscriptions.push(log, diagListener, shellExecListener, closeListener, testCommand);
}
function deactivate() {
    // Nothing to clean up — all listeners are disposed via context.subscriptions
}
// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------
function getTotalErrorCount() {
    return vscode.languages
        .getDiagnostics()
        .flatMap(([, diags]) => diags)
        .filter(d => d.severity === vscode.DiagnosticSeverity.Error)
        .length;
}
//# sourceMappingURL=extension.js.map