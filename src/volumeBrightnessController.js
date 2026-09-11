import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

// ==========================================
// БЛОК ЗВУКУ ТА ЯСКРАВОСТІ
// ==========================================
//
// Обробляє прокрутку колеса миші в зоні чутливості: верхня половина —
// гучність, нижня — яскравість. Показує результат у переданому
// CustomOsd і, для яскравості, тимчасово блокує системний OSD через
// SystemOsdPatcher (бо зміна org.gnome...brightness сама викликає
// системний OSD).
export class VolumeBrightnessController {
    constructor(settings, osd, systemOsdPatcher) {
        this._settings = settings;
        this._osd = osd;
        this._systemOsdPatcher = systemOsdPatcher;
        this._lastScrollTime = 0;
    }

    handleVolumeScroll(event) {
        const volUnit =
            Main.panel.statusArea.quickSettings._volumeOutput ||
            Main.panel.statusArea.quickSettings._volume;
        if (!volUnit || !volUnit._control) return Clutter.EVENT_PROPAGATE;

        const sink = volUnit._control.get_default_sink();
        if (!sink) return Clutter.EVENT_PROPAGATE;

        const volumeStep = this._settings.get_int("volume-step") / 100;
        const maxVol = volUnit._control.get_vol_max_norm();
        // delta тепер буде коректним відсотком від максимальної гучності
        const delta = this._getScrollDelta(event, maxVol * volumeStep);

        let newVol = Math.max(0, Math.min(sink.volume + delta, maxVol));
        sink.volume = newVol;
        sink.push_volume();

        if (sink.is_muted && delta > 0) sink.change_is_muted(false);

        const level = newVol / maxVol;
        let iconName = "audio-volume-high-symbolic";
        if (sink.is_muted || level === 0)
            iconName = "audio-volume-muted-symbolic";
        else if (level < 0.33) iconName = "audio-volume-low-symbolic";
        else if (level < 0.66) iconName = "audio-volume-medium-symbolic";

        this._osd.show({ icon: iconName, level: level });
        return Clutter.EVENT_STOP;
    }

    handleBrightnessScroll(event) {
        if (!Main.brightnessManager || !Main.brightnessManager.globalScale)
            return Clutter.EVENT_PROPAGATE;

        const brightnessStep = this._settings.get_int("brightness-step") / 100;
        const delta = this._getScrollDelta(event, brightnessStep);
        if (delta === 0) return Clutter.EVENT_PROPAGATE;

        let scale = Main.brightnessManager.globalScale;
        let current = scale.value !== undefined ? scale.value : scale;

        // Обмежуємо значення строго від 0 до 1
        let newValue = Math.max(0, Math.min(1, current + delta));

        this._systemOsdPatcher.blockTemporarily();
        scale.value = newValue;

        let iconName = "display-brightness-high-symbolic";
        if (newValue < 0.33) iconName = "display-brightness-low-symbolic";
        else if (newValue < 0.66)
            iconName = "display-brightness-medium-symbolic";

        this._osd.show({ icon: iconName, level: newValue });
        return Clutter.EVENT_STOP;
    }

    _getScrollDelta(event, step) {
        // Отримуємо поточний час у мікросекундах
        let now = GLib.get_monotonic_time();

        // Якщо з моменту останнього скролу минуло менше 20 мс (20 000 мкс),
        // ігноруємо цю подію. Це відсікає "дублюючі" сигнали від миші.
        if (this._lastScrollTime && now - this._lastScrollTime < 20000) {
            return 0;
        }

        const direction = event.get_scroll_direction();
        let delta = 0;

        if (direction === Clutter.ScrollDirection.SMOOTH) {
            const [dx, dy] = event.get_scroll_delta();
            if (dy !== 0) {
                // Використовуємо тільки напрямок, щоб крок був фіксованим
                delta = dy > 0 ? -step : step;
            }
        } else if (direction === Clutter.ScrollDirection.UP) {
            delta = step;
        } else if (direction === Clutter.ScrollDirection.DOWN) {
            delta = -step;
        }

        if (delta !== 0) {
            this._lastScrollTime = now; // Запам'ятовуємо час успішного скролу
        }

        return delta;
    }
}
