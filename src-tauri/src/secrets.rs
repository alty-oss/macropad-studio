// Senhas e tokens das integrações, guardados no Gerenciador de Credenciais do Windows em vez do
// config.json.
use std::ptr::null_mut;
use windows_sys::Win32::Security::Credentials::{
    CredDeleteW, CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC,
};

fn target(name: &str) -> Vec<u16> {
    format!("MacropadStudio/{name}").encode_utf16().chain(Some(0)).collect()
}

pub fn read(name: &str) -> Option<String> {
    let target = target(name);
    let mut credential: *mut CREDENTIALW = null_mut();
    unsafe {
        if CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut credential) == 0 {
            return None;
        }
        let blob = std::slice::from_raw_parts((*credential).CredentialBlob, (*credential).CredentialBlobSize as usize);
        let units: Vec<u16> = blob.as_chunks::<2>().0.iter().map(|pair| u16::from_le_bytes(*pair)).collect();
        CredFree(credential as *const _);
        String::from_utf16(&units).ok()
    }
}

// Texto vazio apaga a credencial.
pub fn write(name: &str, secret: &str) -> Result<(), String> {
    let mut target = target(name);
    if secret.is_empty() {
        unsafe { CredDeleteW(target.as_ptr(), CRED_TYPE_GENERIC, 0) };
        return Ok(());
    }
    let mut blob: Vec<u8> = secret.encode_utf16().flat_map(u16::to_le_bytes).collect();
    let credential = CREDENTIALW {
        Flags: 0,
        Type: CRED_TYPE_GENERIC,
        TargetName: target.as_mut_ptr(),
        Comment: null_mut(),
        LastWritten: unsafe { std::mem::zeroed() },
        CredentialBlobSize: blob.len() as u32,
        CredentialBlob: blob.as_mut_ptr(),
        Persist: CRED_PERSIST_LOCAL_MACHINE,
        AttributeCount: 0,
        Attributes: null_mut(),
        TargetAlias: null_mut(),
        UserName: null_mut(),
    };
    if unsafe { CredWriteW(&credential, 0) } == 0 {
        return Err("Não foi possível guardar a credencial no Windows.".into());
    }
    Ok(())
}
