// Keeps the console window from flashing up alongside the app on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    ymusic_lib::run()
}
