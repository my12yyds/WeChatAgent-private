"""One-shot UI adapter. No scheduler, no detached process, no login automation."""
import contextlib
import datetime
import hashlib
import json
import os
from pathlib import Path
import sys
import time


def emit(value):
    print(json.dumps(value, ensure_ascii=True), flush=True)


def save(path, value):
    tmp = path.with_suffix('.tmp')
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(value, f, ensure_ascii=False)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


@contextlib.contextmanager
def exclusive(folder):
    import msvcrt
    folder.mkdir(parents=True, exist_ok=True)
    with open(folder / 'publisher.lock', 'a+b') as f:
        f.seek(0)
        f.write(b'0')
        f.flush()
        f.seek(0)
        msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
        try:
            yield
        finally:
            f.seek(0)
            msvcrt.locking(f.fileno(), msvcrt.LK_UNLCK, 1)


def validate(req):
    if req.get('mode') not in ('preview', 'publish'):
        raise ValueError('INVALID_MODE')
    if not isinstance(req.get('pid'), int) or req['pid'] < 1:
        raise ValueError('INVALID_PID')
    if not isinstance(req.get('text'), str) or not 1 <= len(req['text'].strip()) <= 280:
        raise ValueError('INVALID_TEXT')
    max_posts = req.get('maxPosts', 1)
    if not isinstance(max_posts, int) or not 1 <= max_posts <= 3:
        raise ValueError('INVALID_MAX_POSTS')
    date = datetime.date.fromisoformat(req['date'])
    today = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).date()
    if date != today:
        raise ValueError('DATE_CHANGED')
    if not Path(req['receiptDir']).is_absolute():
        raise ValueError('INVALID_RECEIPT_DIRECTORY')


def operate(req, driver, authorize, folder):
    """Durable daily receipt is account-wide, across chats and personas."""
    receipt = folder / (req['date'] + '.json')
    max_posts = int(req.get('maxPosts') or 1)
    count = 0
    text_hash = hashlib.sha256(req['text'].encode()).hexdigest()
    if receipt.exists():
        old = json.loads(receipt.read_text(encoding='utf-8'))
        count = int(old.get('count') or (1 if old.get('status') else 0))
        if req['mode'] == 'publish' and (count >= max_posts or old.get('status') in ('committing', 'unknown') or old.get('textHash') == text_hash):
            return {'ok': True, 'status': 'blocked_existing_receipt', 'receipt': old}
    driver.prepare(req['text'])
    if req['mode'] == 'preview':
        return {'ok': True, 'status': 'preview_ready', 'published': False}
    if not authorize():
        raise RuntimeError('COMMIT_NOT_AUTHORIZED')
    validate(req)
    driver.validate_ready(req['text'])
    record = {'status': 'committing', 'count': count + 1, 'textHash': text_hash,
              'at': datetime.datetime.now(datetime.timezone.utc).isoformat()}
    save(receipt, record)  # Crash from here on must block automatic retries.
    try:
        driver.publish()
        record['status'] = 'submitted_unverified'
    except Exception:
        record['status'] = 'unknown'
    save(receipt, record)
    return {'ok': True, 'status': record['status'], 'published': None,
            'message': '已尝试点击发表，尚无服务端回执；请在朋友圈核对，不会自动重试。'}


class WindowsDriver:
    def __init__(self, pid):
        import ctypes
        from ctypes import wintypes
        from pywinauto import Desktop
        # Locked/noninteractive desktops must not receive input.
        user32 = ctypes.WinDLL('user32', use_last_error=True)
        user32.OpenInputDesktop.restype = wintypes.HANDLE
        user32.OpenInputDesktop.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        handle = user32.OpenInputDesktop(0, False, 0x0100)
        if not handle:
            raise RuntimeError('DESKTOP_LOCKED_OR_UNAVAILABLE')
        user32.SwitchDesktop.argtypes = [wintypes.HANDLE]
        user32.CloseDesktop.argtypes = [wintypes.HANDLE]
        try:
            if not user32.SwitchDesktop(handle):
                raise RuntimeError('DESKTOP_LOCKED_OR_UNAVAILABLE')
        finally:
            user32.CloseDesktop(handle)
        self.desktop = Desktop(backend='uia')
        self.pid = pid
        roots = self.desktop.windows(process=pid, visible_only=True)
        mains = [w for w in roots if w.class_name() == 'mmui::MainWindow']
        if len(mains) != 1:
            raise RuntimeError('MAIN_WINDOW_NOT_UNIQUE_OR_LOGIN_REQUIRED')
        self.main = mains[0]
        if self.main.is_minimized():
            self.main.restore()

    def panel(self):
        # Qt may expose the editor as an owned Window or a child Group.
        roots = self.desktop.windows(process=self.pid, visible_only=True)
        found = []
        for root in roots:
            child = self.find_first(root, auto_id='SnsPublishPanel')
            candidates = [root] + ([child] if child else [])
            for item in candidates:
                if item.element_info.automation_id == 'SnsPublishPanel' and item.is_visible():
                    if not any(item == previous for previous in found):
                        found.append(item)
        if len(found) > 1:
            raise RuntimeError('PUBLISH_PANEL_NOT_UNIQUE')
        return found[0] if found else None

    @staticmethod
    def find_first(root, title=None, control_type=None, auto_id=None):
        from pywinauto.uia_defines import IUIA
        from pywinauto.uia_element_info import UIAElementInfo
        from pywinauto.controls.uiawrapper import UIAWrapper
        uia = IUIA()
        condition = uia.build_condition(title=title, control_type=control_type)
        if auto_id:
            by_id = uia.iuia.CreatePropertyCondition(uia.UIA_dll.UIA_AutomationIdPropertyId, auto_id)
            condition = uia.iuia.CreateAndCondition(condition, by_id)
        element = root.element_info._element.FindFirst(4, condition)
        return UIAWrapper(UIAElementInfo(element)) if element else None

    def named(self, root, title, control_type='Button'):
        item = self.find_first(root, title=title, control_type=control_type)
        if item is None or not item.is_visible():
            raise RuntimeError('CONTROL_NOT_FOUND: '+title)
        return item

    @staticmethod
    def unique(items, label):
        items = [i for i in items if i.is_visible()]
        # Qt can repeat the same accessible button through nested virtual groups.
        # Collapse only identical visible controls at the exact same bounds.
        distinct = {}
        for item in items:
            rect = item.rectangle()
            key = (item.window_text(), item.class_name(), item.element_info.control_type,
                   item.element_info.automation_id, rect.left, rect.top, rect.right, rect.bottom)
            distinct.setdefault(key, item)
        items = list(distinct.values())
        if len(items) != 1:
            raise RuntimeError(label + ': ' + str(len(items)) + ' candidates')
        return items[0]

    def prepare(self, text):
        self.main.set_focus()
        existing = self.panel()
        if existing:
            self.editor = self.unique(existing.descendants(control_type='Edit'), 'EDITOR_NOT_UNIQUE')
            current = self.editor.window_text()
            if current.strip() and current.strip() != text.strip():
                raise RuntimeError('EXISTING_DRAFT_PRESERVED')
            self.publish_panel = existing
        else:
            self.named(self.main, '发现').click_input()
            time.sleep(1)
            self.named(self.main, '朋友圈').click_input()
            time.sleep(.7)
            self.named(self.main, '发表').right_click_input()
            time.sleep(.2)
            # Select by accessible caption, never by blind Enter or guessed coordinates.
            menus = self.desktop.windows(process=self.pid, visible_only=True)
            entries = []
            for menu in menus:
                entry = self.find_first(menu, title='发表文字', control_type='MenuItem')
                if entry:
                    entries.append(entry)
            self.unique(entries, 'TEXT_MENU_NOT_ACCESSIBLE').click_input()
            deadline = time.monotonic() + 2
            self.publish_panel = self.panel()
            while self.publish_panel is None and time.monotonic() < deadline:
                time.sleep(.1)
                self.publish_panel = self.panel()
            if self.publish_panel is None:
                raise RuntimeError('PUBLISH_PANEL_NOT_ACCESSIBLE')
            self.editor = self.unique(self.publish_panel.descendants(control_type='Edit'), 'EDITOR_NOT_UNIQUE')
        self.editor.set_focus()
        # Direct UIA ValuePattern avoids the prior tool's Unicode input/focus failure.
        try:
            self.editor.set_edit_text(text)
        except Exception:
            pass
        if self.editor.window_text().strip() != text.strip():
            # Clipboard paste is restricted to the verified edit control.
            import win32clipboard
            win32clipboard.OpenClipboard()
            try:
                old = win32clipboard.GetClipboardData(win32clipboard.CF_UNICODETEXT) if win32clipboard.IsClipboardFormatAvailable(win32clipboard.CF_UNICODETEXT) else None
                if old is None and win32clipboard.EnumClipboardFormats(0):
                    raise RuntimeError('NON_TEXT_CLIPBOARD_PRESERVED')
                win32clipboard.EmptyClipboard()
                win32clipboard.SetClipboardText(text, win32clipboard.CF_UNICODETEXT)
            finally:
                win32clipboard.CloseClipboard()
            try:
                self.editor.click_input()
                self.editor.type_keys('^a^v', set_foreground=True)
                time.sleep(.2)
            finally:
                win32clipboard.OpenClipboard()
                try:
                    win32clipboard.EmptyClipboard()
                    if old is not None:
                        win32clipboard.SetClipboardText(old, win32clipboard.CF_UNICODETEXT)
                finally:
                    win32clipboard.CloseClipboard()
        self.validate_ready(text)

    def validate_ready(self, text):
        if self.editor.window_text().strip() != text.strip():
            raise RuntimeError('EDITOR_TEXT_VERIFICATION_FAILED')
        self.post = self.unique(self.publish_panel.descendants(title='发表', control_type='Button'), 'FINAL_POST_NOT_UNIQUE')
        if not self.post.is_enabled():
            raise RuntimeError('FINAL_POST_DISABLED')

    def publish(self):
        self.post.click_input()


def main():
    req = json.loads(sys.stdin.readline())
    validate(req)
    folder = Path(req['receiptDir'])
    def authorize():
        emit({'event': 'ready'})
        return json.loads(sys.stdin.readline()).get('commit') is True
    with exclusive(folder):
        result = operate(req, WindowsDriver(req['pid']), authorize, folder)
    emit({'event': 'result', **result})


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        emit({'event': 'result', 'ok': False, 'retryLater': True, 'status': 'failed_before_commit',
              'error': type(e).__name__ + ': ' + str(e)[:200]})
