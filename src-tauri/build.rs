use std::env;
use std::path::PathBuf;

fn main() {
    println!("cargo:rerun-if-changed=binaries/");
    println!("cargo:rerun-if-changed=binaries/ffmpeg/include/wrapper.h");

    let manifest_dir = env::var("CARGO_MANIFEST_DIR").unwrap();
    let include_path = PathBuf::from(&manifest_dir).join("binaries/ffmpeg/include");
    let wrapper_path = include_path.join("wrapper.h");

    if wrapper_path.exists() {
        let bindings = bindgen::Builder::default()
            .header(wrapper_path.to_string_lossy())
            .clang_arg(format!("-I{}", include_path.display()))
            .allowlist_type("AV.*")
            .allowlist_type("Swr.*")
            .allowlist_var("AV.*")
            .allowlist_var("AVERROR.*")
            .allowlist_var("SWR.*")
            .blocklist_function(".*")
            .derive_default(true)
            .derive_debug(true)
            .generate_comments(false)
            .layout_tests(false)
            .generate()
            .expect("Unable to generate FFmpeg bindings");

        let out_path = PathBuf::from(env::var("OUT_DIR").unwrap());
        bindings
            .write_to_file(out_path.join("ffmpeg_bindings.rs"))
            .expect("Couldn't write bindings!");
    }

    tauri_build::build()
}
