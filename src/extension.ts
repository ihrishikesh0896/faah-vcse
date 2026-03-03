import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as os from 'os';
import * as fs from 'fs';

// ---------------------------------------------------------------------------
// Resolve the bundled default sound packaged with the extension
// ---------------------------------------------------------------------------
function getBundledSoundPath(extensionPath: string): string {
    const bundled = `${extensionPath}/media/error.mp3`;
    return fs.existsSync(bundled) ? bundled : '';
}

// ---------------------------------------------------------------------------
// Cross-platform audio playback
// ---------------------------------------------------------------------------
function playSound(soundPath: string): void {
    if (!soundPath) {
        vscode.window.showWarningMessage(
            'Faaah: No sound file found. Set a custom path via "faaah.soundFile" in settings.'
        );
        return;
    }

    if (!fs.existsSync(soundPath)) {
        vscode.window.showWarningMessage(
            `Faaah: Sound file not found: ${soundPath}`
        );
        return;
    }

    const platform = os.platform();

    try {
        if (platform === 'darwin') {
            cp.spawn('afplay', [soundPath], { detached: true, stdio: 'ignore' }).unref();

        } else if (platform === 'win32') {
            // Use PowerShell's SoundPlayer for .wav; fall back to Media.player for others
            const script = `Add-Type -AssemblyName presentationCore; $player = New-Object System.Windows.Media.MediaPlayer; $player.Open([uri]'${soundPath}'); $player.Play(); Start-Sleep -Milliseconds 3000`;
            cp.spawn('powershell', ['-NonInteractive', '-Command', script], {
                detached: true,
                stdio: 'ignore',
            }).unref();

        } else {
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
            vscode.window.showWarningMessage(
                'Faaah: No audio player found on Linux. Install paplay, aplay, ffplay, or mplayer.'
            );
        }
    } catch (err) {
        console.error('Faaah: error playing sound', err);
    }
}

// ---------------------------------------------------------------------------
// Extension activation
// ---------------------------------------------------------------------------
export function activate(context: vscode.ExtensionContext): void {
    let previousErrorCount = getTotalErrorCount();
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;

    // ------------------------------------------------------------------
    // Helper: resolve the sound path from settings → bundled default
    // ------------------------------------------------------------------
    function resolveSoundPath(): string {
        const config = vscode.workspace.getConfiguration('faaah');
        const custom = config.get<string>('soundFile', '').trim();
        if (custom !== '') {
            return custom;
        }
        return getBundledSoundPath(context.extensionPath);
    }

    // ------------------------------------------------------------------
    // Helper: debounced trigger
    // ------------------------------------------------------------------
    function triggerSound(): void {
        const config = vscode.workspace.getConfiguration('faaah');
        if (!config.get<boolean>('enabled', true)) {
            return;
        }

        const delay = config.get<number>('debounceMs', 500);

        if (debounceTimer !== undefined) {
            clearTimeout(debounceTimer);
        }

        debounceTimer = setTimeout(() => {
            playSound(resolveSoundPath());
            debounceTimer = undefined;
        }, delay);
    }

    // ------------------------------------------------------------------
    // 1. Watch the Problems panel (diagnostics) for NEW errors
    // ------------------------------------------------------------------
    const diagListener = vscode.languages.onDidChangeDiagnostics(() => {
        const currentErrorCount = getTotalErrorCount();

        if (currentErrorCount > previousErrorCount) {
            triggerSound();
        }

        previousErrorCount = currentErrorCount;
    });

    // ------------------------------------------------------------------
    // 2. Watch terminals for non-zero exit codes
    // ------------------------------------------------------------------
    const terminalListener = vscode.window.onDidCloseTerminal(terminal => {
        const exitCode = terminal.exitStatus?.code;
        if (exitCode !== undefined && exitCode !== 0) {
            triggerSound();
        }
    });

    // ------------------------------------------------------------------
    // 3. "Test Sound" command
    // ------------------------------------------------------------------
    const testCommand = vscode.commands.registerCommand('faaah.testSound', () => {
        const soundPath = resolveSoundPath();
        if (!soundPath) {
            vscode.window.showErrorMessage(
                'Faaah: No sound file available. Configure "faaah.soundFile" in settings.'
            );
            return;
        }
        vscode.window.showInformationMessage(`Faaah: Playing ${soundPath}`);
        playSound(soundPath);
    });

    context.subscriptions.push(diagListener, terminalListener, testCommand);
}

export function deactivate(): void {
    // Nothing to clean up — all listeners are disposed via context.subscriptions
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------
function getTotalErrorCount(): number {
    return vscode.languages
        .getDiagnostics()
        .flatMap(([, diags]) => diags)
        .filter(d => d.severity === vscode.DiagnosticSeverity.Error)
        .length;
}
