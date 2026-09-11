import GLib from "gi://GLib";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

// На холодному старті сесії Main.osdWindowManager інколи ще не існує
// в момент enable() розширення (та сама "гонка", через яку знадобився
// warmUp() у CustomOsd). Тому пробуємо запатчити ще раз із затримкою,
// поки об'єкт не з'явиться.
const PATCH_RETRY_INTERVAL_MS = 200;
const PATCH_RETRY_MAX_ATTEMPTS = 50; // ~10с

// ==========================================
// ПАТЧ СИСТЕМНОГО OSD
// ==========================================
//
// Перехоплює Main.osdWindowManager.show(), щоб системний OSD гучності/
// яскравості/дисплея не показувався поверх нашого власного OSD, і надає
// спосіб тимчасово блокувати системний OSD навіть тоді, коли він
// викликається не напряму нами (наприклад, автоматично через зміну
// org.gnome.settings-daemon.plugins.power, або одразу після входу в
// систему, коли розширення саме відновлює збережені рівні).
export class SystemOsdPatcher {
    constructor() {
        this._blocked = false;
        this._originalShow = null;
        this._unblockTimeoutId = null;
        this._patchRetryId = null;
    }

    enable() {
        this._patchAttempts = 0;
        this._tryPatch();
    }

    _tryPatch() {
        if (!Main.osdWindowManager) {
            if (this._patchAttempts >= PATCH_RETRY_MAX_ATTEMPTS) return;
            this._patchAttempts++;
            this._patchRetryId = GLib.timeout_add(
                GLib.PRIORITY_DEFAULT,
                PATCH_RETRY_INTERVAL_MS,
                () => {
                    this._patchRetryId = null;
                    this._tryPatch();
                    return GLib.SOURCE_REMOVE;
                },
            );
            return;
        }

        this._originalShow = Main.osdWindowManager.show;
        Main.osdWindowManager.show = (...args) => {
            const icon = args[1];
            const level = args[3];

            // to_string() може кинути виняток для нетипових реалізацій
            // GIcon — не даємо цьому зламати весь патч.
            let iconStr = "";
            try {
                iconStr = icon ? icon.to_string().toLowerCase() : "";
            } catch (e) {
                iconStr = "";
            }

            const iconMatches =
                iconStr.includes("brightness") ||
                iconStr.includes("display") ||
                iconStr.includes("volume") ||
                iconStr.includes("audio");

            // Резервна перевірка на випадок, коли іконку не вдалось
            // розпізнати (порожній iconStr), а числовий рівень все ж
            // передано — майже напевно це саме OSD гучності/яскравості.
            const isTarget =
                iconMatches ||
                (iconStr === "" &&
                    typeof level === "number" &&
                    level >= 0 &&
                    level <= 1);

            if (this._blocked || isTarget) return;
            this._originalShow.apply(Main.osdWindowManager, args);
        };
    }

    // Блокує системний OSD негайно і плановано знімає блокування через
    // `durationMs` — повторний виклик під час дії блокування просто
    // продовжує таймер (корисно при швидкій повторній прокрутці).
    blockTemporarily(durationMs = 150) {
        this._blocked = true;

        if (this._unblockTimeoutId) GLib.Source.remove(this._unblockTimeoutId);
        this._unblockTimeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            durationMs,
            () => {
                this._blocked = false;
                this._unblockTimeoutId = null;
                return GLib.SOURCE_REMOVE;
            },
        );
    }

    disable() {
        if (this._patchRetryId) {
            GLib.Source.remove(this._patchRetryId);
            this._patchRetryId = null;
        }
        if (this._unblockTimeoutId) {
            GLib.Source.remove(this._unblockTimeoutId);
            this._unblockTimeoutId = null;
        }
        if (this._originalShow) {
            Main.osdWindowManager.show = this._originalShow;
            this._originalShow = null;
        }
        this._blocked = false;
    }
}
