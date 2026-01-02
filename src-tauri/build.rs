fn main() {
    // Ensure we rebuild if binaries change
    println!("cargo:rerun-if-changed=binaries/");
    tauri_build::build()
}
