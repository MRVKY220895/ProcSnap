import os
import zipfile

root_dir = os.path.dirname(os.path.abspath(__file__))
zip_filename = os.path.join(root_dir, "ProcSnap_Portable.zip")

exclude_dirs = {".venv", "__pycache__", ".git", ".idea", ".pytest_cache", "node_modules", "screenshots", "storage", "media"}
exclude_exts = {".pyc", ".pyo", ".zip", ".tmp", ".log"}
exclude_files = {"ProcSnap_Portable.zip", "procsnap.db", "tango.db"}

print(f"Creating clean portable zip: {zip_filename}")
with zipfile.ZipFile(zip_filename, "w", zipfile.ZIP_DEFLATED) as zipf:
    for base, dirs, files in os.walk(root_dir):
        dirs[:] = [d for d in dirs if d not in exclude_dirs]
        for file in files:
            ext = os.path.splitext(file)[1].lower()
            if ext in exclude_exts or file in exclude_files:
                continue
            abs_path = os.path.join(base, file)
            rel_path = os.path.relpath(abs_path, root_dir)
            arc_name = os.path.join("ProcSnap", rel_path)
            zipf.write(abs_path, arc_name)

print("ProcSnap Portable ZIP build complete!")
