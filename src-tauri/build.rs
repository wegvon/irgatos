fn main() {
    // generate_context! embeds icons; cargo ignores them unless we watch here.
    println!("cargo:rerun-if-changed=icons");
    println!("cargo:rerun-if-changed=macos/Assets.car");
    println!("cargo:rerun-if-changed=tauri.conf.json");
    let config =
        std::fs::read_to_string("tauri.conf.json").expect("read src-tauri/tauri.conf.json");
    let config = serde_json::from_str::<serde_json::Value>(&config)
        .expect("parse src-tauri/tauri.conf.json");
    let product_name = config
        .get("productName")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .expect("tauri.conf.json must define a non-empty productName");
    println!("cargo:rustc-env=TAURI_PRODUCT_NAME={product_name}");
    // GNU ld exports every symbol from the Tauri cdylib and blows past the
    // 65535 PE ordinal limit. Hide them; the desktop exe links the rlib.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("gnu")
    {
        println!("cargo::rustc-link-arg-cdylib=-Wl,--exclude-libs=ALL,--exclude-all-symbols");
    }
    tauri_build::build()
}
