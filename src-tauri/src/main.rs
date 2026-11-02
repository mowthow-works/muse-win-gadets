// Always hide console window on Windows (both debug and release)
#![windows_subsystem = "windows"]

#[cfg(windows)]
mod single_instance {
    use std::ptr::null;
    const ERROR_ALREADY_EXISTS: u32 = 183;

    extern "system" {
        fn CreateMutexW(
            lpMutexAttributes: *const std::ffi::c_void,
            bInitialOwner: i32,
            lpName: *const u16,
        ) -> *mut std::ffi::c_void;
        fn GetLastError() -> u32;
        fn CloseHandle(hObject: *mut std::ffi::c_void) -> i32;
    }

    pub struct SingleInstanceGuard(*mut std::ffi::c_void);

    impl Drop for SingleInstanceGuard {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe {
                    CloseHandle(self.0);
                }
            }
        }
    }

    pub fn acquire(name: &str) -> Option<SingleInstanceGuard> {
        let wide: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();
        unsafe {
            let handle = CreateMutexW(null(), 1, wide.as_ptr());
            if handle.is_null() {
                return None;
            }
            if GetLastError() == ERROR_ALREADY_EXISTS {
                CloseHandle(handle);
                return None;
            }
            Some(SingleInstanceGuard(handle))
        }
    }
}

fn main() {
    #[cfg(windows)]
    let _guard = match single_instance::acquire("Local\\works.mowthow.muse.gadgets.single_instance") {
        Some(g) => g,
        None => {
            // 既に起動中のプロセスが存在するため多重起動せずに終了
            return;
        }
    };

    muse_desktop_mascot_lib::run()
}
