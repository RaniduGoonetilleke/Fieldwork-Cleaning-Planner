"""Check that the downloaded app matches its recorded release files."""
from hashlib import sha256
import json
from pathlib import Path


def verify(root=None):
    root = Path(root or Path(__file__).resolve().parent).resolve()
    manifest = json.loads((root / 'RELEASE_MANIFEST.json').read_text())
    if manifest.get('schema') != 'fieldwork-release-v1':
        raise ValueError('This release file has an unsupported format.')
    entries = manifest.get('files')
    if not isinstance(entries, dict) or not entries:
        raise ValueError('The release file has no file list.')
    for relative, expected in entries.items():
        path = (root / relative).resolve()
        if Path(relative).is_absolute() or not path.is_relative_to(root):
            raise ValueError('The release contains an invalid file path.')
        if not path.is_file() or sha256(path.read_bytes()).hexdigest() != expected:
            raise ValueError('File missing or changed: ' + relative)
    return len(entries)


if __name__ == '__main__':
    try:
        print('Release files checked:', verify())
    except (ValueError, OSError, KeyError) as exc:
        raise SystemExit(str(exc)) from exc
