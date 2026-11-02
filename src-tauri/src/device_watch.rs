// Observa a chegada e a remoção do macropad sem polling periódico.
use std::{mem::size_of, ptr::null_mut, sync::Arc, thread};
use windows_sys::Win32::{
    Devices::HumanInterfaceDevice::GUID_DEVINTERFACE_HID,
    Foundation::HWND,
    UI::WindowsAndMessaging::{
        CreateWindowExW, GetMessageW, RegisterDeviceNotificationW, DEV_BROADCAST_DEVICEINTERFACE_W,
        DBT_DEVICEARRIVAL, DBT_DEVICEREMOVECOMPLETE, DBT_DEVNODES_CHANGED, DBT_DEVTYP_DEVICEINTERFACE,
        DEVICE_NOTIFY_WINDOW_HANDLE, HWND_MESSAGE, MSG, WM_DEVICECHANGE,
    },
};

type Callback = Arc<dyn Fn() + Send + Sync>;

pub fn start(on_change: impl Fn() + Send + Sync + 'static) {
    let on_change: Callback = Arc::new(on_change);
    thread::spawn(move || unsafe {
        let class: Vec<u16> = "STATIC\0".encode_utf16().collect();
        let window: HWND = CreateWindowExW(
            0,
            class.as_ptr(),
            class.as_ptr(),
            0,
            0,
            0,
            0,
            0,
            HWND_MESSAGE,
            null_mut(),
            null_mut(),
            null_mut(),
        );
        if window.is_null() {
            eprintln!("Nao foi possivel criar o observador de dispositivos.");
            return;
        }
        let filter = DEV_BROADCAST_DEVICEINTERFACE_W {
            dbcc_size: size_of::<DEV_BROADCAST_DEVICEINTERFACE_W>() as u32,
            dbcc_devicetype: DBT_DEVTYP_DEVICEINTERFACE,
            dbcc_reserved: 0,
            dbcc_classguid: GUID_DEVINTERFACE_HID,
            dbcc_name: [0],
        };
        if RegisterDeviceNotificationW(window as _, &filter as *const _ as _, DEVICE_NOTIFY_WINDOW_HANDLE).is_null() {
            eprintln!("Nao foi possivel registrar o observador de dispositivos.");
            return;
        }
        on_change();
        let mut message: MSG = std::mem::zeroed();
        while GetMessageW(&mut message, null_mut(), 0, 0) > 0 {
            if message.message == WM_DEVICECHANGE
                && matches!(message.wParam as u32, DBT_DEVICEARRIVAL | DBT_DEVICEREMOVECOMPLETE | DBT_DEVNODES_CHANGED)
            {
                on_change();
            }
        }
    });
}
