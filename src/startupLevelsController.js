import GLib from "gi://GLib";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

// Як часто фіксуємо поточні рівні гучності/яскравості в GSettings,
// щоб на момент завершення роботи там завжди було свіже значення
// (незалежно від того, чим саме була змінена гучність/яскравість —
// нашим скролом, медіа-клавішами чи іншим застосунком).
const POLL_INTERVAL_MS = 3000;

// На холодному старті сесії панель гучності (quickSettings) та
// Main.brightnessManager можуть бути ще не готові в момент enable().
// Той самий підхід, що й warmUp() у CustomOsd: пробуємо ще раз із
// невеликою затримкою, поки об'єкти не з'являться.
const STARTUP_RETRY_INTERVAL_MS = 500;
const STARTUP_RETRY_MAX_ATTEMPTS = 20;

// Проста евристика "день/ніч" за годиною доби локального часу.
const DAY_START_HOUR = 6;
const DAY_END_HOUR = 18;

// ==========================================
// АВТОМАТИЧНІ РІВНІ ГУЧНОСТІ ТА ЯСКРАВОСТІ
// ==========================================
//
// При enable() відновлює гучність/яскравість відповідно до налаштувань
// користувача:
//   - якщо увімкнено "Останнє значення" — виставляє значення, збережене
//     перед завершенням попередньої сесії (volume-last-value /
//     brightness-last-value);
//   - інакше — використовує профіль "День / Ніч" (volume-restore-day /
//     volume-restore-night, і аналогічно для яскравості) залежно від
//     поточного часу доби.
//
// Паралельно періодично зберігає поточні рівні гучності й яскравості
// в GSettings, щоб "останнє значення" завжди було актуальним на момент
// завершення роботи, перезавантаження чи Log Out.
export class StartupLevelsController {
    constructor(settings, systemOsdPatcher) {
        this._settings = settings;
        this._systemOsdPatcher = systemOsdPatcher;
        this._pollId = null;
        this._retryId = null;
    }

    enable() {
        this._applyStartupLevels();

        this._pollId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            POLL_INTERVAL_MS,
            () => {
                this._recordCurrentLevels();
                return GLib.SOURCE_CONTINUE;
            },
        );
    }

    _getVolumeControl() {
        const quickSettings = Main.panel.statusArea.quickSettings;
        const volUnit =
            quickSettings?._volumeOutput || quickSettings?._volume;
        if (!volUnit || !volUnit._control) return null;

        const sink = volUnit._control.get_default_sink();
        if (!sink) return null;

        return { control: volUnit._control, sink };
    }

    _getBrightnessScale() {
        if (!Main.brightnessManager || !Main.brightnessManager.globalScale)
            return null;
        return Main.brightnessManager.globalScale;
    }

    _isDaytime() {
        const hour = GLib.DateTime.new_now_local().get_hour();
        return hour >= DAY_START_HOUR && hour < DAY_END_HOUR;
    }

    // Фіксує поточні рівні гучності/яскравості як "останнє значення".
    _recordCurrentLevels() {
        const vol = this._getVolumeControl();
        if (vol) {
            const maxVol = vol.control.get_vol_max_norm();
            const percent = Math.round((vol.sink.volume / maxVol) * 100);
            this._settings.set_int(
                "volume-last-value",
                Math.max(0, Math.min(100, percent)),
            );
        }

        const scale = this._getBrightnessScale();
        if (scale) {
            const current = scale.value !== undefined ? scale.value : scale;
            const percent = Math.round(current * 100);
            this._settings.set_int(
                "brightness-last-value",
                Math.max(0, Math.min(100, percent)),
            );
        }
    }

    _applyStartupLevels() {
        // Захист від системного OSD (гучності/яскравості), який може
        // з'явитись саме в момент відновлення збережених рівнів при
        // старті сесії — навіть якщо SystemOsdPatcher вже пропатчив
        // Main.osdWindowManager, зайва підстраховка тут не завадить.
        this._systemOsdPatcher?.blockTemporarily(2000);

        let volumeDone = this._applyVolume();
        let brightnessDone = this._applyBrightness();

        if (volumeDone && brightnessDone) return;

        let attempts = 0;
        this._retryId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            STARTUP_RETRY_INTERVAL_MS,
            () => {
                attempts++;
                this._systemOsdPatcher?.blockTemporarily(2000);

                if (!volumeDone) volumeDone = this._applyVolume();
                if (!brightnessDone) brightnessDone = this._applyBrightness();

                const done = volumeDone && brightnessDone;
                if (done || attempts >= STARTUP_RETRY_MAX_ATTEMPTS) {
                    this._retryId = null;
                    return GLib.SOURCE_REMOVE;
                }
                return GLib.SOURCE_CONTINUE;
            },
        );
    }

    // Повертає true, якщо вдалося застосувати (панель гучності готова),
    // false — якщо потрібно повторити спробу пізніше.
    _applyVolume() {
        const vol = this._getVolumeControl();
        if (!vol) return false;

        const percent = this._settings.get_boolean(
            "volume-restore-last-value",
        )
            ? this._settings.get_int("volume-last-value")
            : this._isDaytime()
              ? this._settings.get_int("volume-restore-day")
              : this._settings.get_int("volume-restore-night");

        const maxVol = vol.control.get_vol_max_norm();
        vol.sink.volume = maxVol * (percent / 100);
        vol.sink.push_volume();
        return true;
    }

    _applyBrightness() {
        const scale = this._getBrightnessScale();
        if (!scale) return false;

        const percent = this._settings.get_boolean(
            "brightness-restore-last-value",
        )
            ? this._settings.get_int("brightness-last-value")
            : this._isDaytime()
              ? this._settings.get_int("brightness-restore-day")
              : this._settings.get_int("brightness-restore-night");

        scale.value = percent / 100;
        return true;
    }

    disable() {
        if (this._pollId) {
            GLib.Source.remove(this._pollId);
            this._pollId = null;
        }
        if (this._retryId) {
            GLib.Source.remove(this._retryId);
            this._retryId = null;
        }
        // Остання нагода зафіксувати актуальне значення перед вимкненням
        // розширення (наприклад, під час Log Out).
        this._recordCurrentLevels();
        this._settings = null;
    }
}
