"""Comprueba un IPA propio sin firmar, sin necesitar macOS ni credenciales Apple."""
import argparse
import hashlib
import json
import plistlib
import struct
import zipfile
from pathlib import Path, PurePosixPath


def inspect_macho(data):
    """Identifica la plataforma real, incluso en un ejecutable universal ARM64."""
    if data[:4] in (b'\xca\xfe\xba\xbe', b'\xca\xfe\xba\xbf'):
        wide = data[:4] == b'\xca\xfe\xba\xbf'
        count = struct.unpack_from('>I', data, 4)[0]
        if not 0 < count <= 16:
            raise ValueError('Cabecera universal Mach-O inválida')
        slices = []
        for i in range(count):
            start = 8 + i * (32 if wide else 20)
            offset, size = struct.unpack_from('>QQ' if wide else '>II', data, start + 8)
            if offset + size > len(data):
                raise ValueError('Segmento Mach-O truncado')
            slices.extend(inspect_macho(data[offset:offset + size]))
        return slices
    if data[:4] != b'\xcf\xfa\xed\xfe' or len(data) < 32:
        raise ValueError('El ejecutable no es Mach-O de 64 bits')
    cpu = struct.unpack_from('<I', data, 4)[0]
    if cpu != 0x0100000C:
        raise ValueError('El ejecutable no es ARM64 para iPhone')
    count, size = struct.unpack_from('<II', data, 16)
    end = 32 + size
    if end > len(data):
        raise ValueError('Comandos Mach-O truncados')
    offset = 32
    platforms = []
    for _ in range(count):
        if offset + 8 > end:
            raise ValueError('Comando Mach-O truncado')
        command, length = struct.unpack_from('<II', data, offset)
        if length < 8 or offset + length > end:
            raise ValueError('Longitud de comando Mach-O inválida')
        if command == 0x32:
            if length < 24:
                raise ValueError('LC_BUILD_VERSION inválido')
            platforms.append(struct.unpack_from('<I', data, offset + 8)[0])
        elif command == 0x25:
            platforms.append(2)  # LC_VERSION_MIN_IPHONEOS, para bibliotecas antiguas.
        elif command in (0x21, 0x2C):
            if length < 20 or struct.unpack_from('<I', data, offset + 16)[0]:
                raise ValueError('El ejecutable está cifrado y no puede volver a firmarse')
        offset += length
    if not platforms or any(platform != 2 for platform in platforms):
        raise ValueError('El binario pertenece al simulador u otra plataforma; se necesita iphoneos')
    return [{'architecture': 'arm64', 'platform': 'iphoneos'}]


def verify_ipa(filename, version, bundle_id):
    filename = Path(filename)
    with zipfile.ZipFile(filename) as ipa:
        names = ipa.namelist()
        if len(names) != len(set(names)):
            raise ValueError('El IPA contiene rutas duplicadas')
        for name in names:
            parts = PurePosixPath(name).parts
            if name.startswith('/') or '..' in parts or '\\' in name:
                raise ValueError('El IPA contiene una ruta insegura')
            if any(part.lower().startswith('.env') for part in parts) or name.lower().endswith(
                    ('.p8', '.p12', '.pem', '.key', '.jks', '.mobileprovision')):
                raise ValueError('El IPA contiene credenciales o un perfil de firma inesperado')
        infos = [name for name in names if len(PurePosixPath(name).parts) == 3
                 and name.startswith('Payload/') and name.endswith('.app/Info.plist')]
        if len(infos) != 1:
            raise ValueError('Se necesita una única aplicación en Payload')
        info = plistlib.loads(ipa.read(infos[0]))
        if info.get('CFBundleSupportedPlatforms') != ['iPhoneOS']:
            raise ValueError('La app no declara iPhoneOS real')
        if info.get('CFBundleIdentifier') != bundle_id or info.get('CFBundleShortVersionString') != version:
            raise ValueError('Versión o bundle identifier distintos de la fuente')
        for permission in ('NSMicrophoneUsageDescription', 'NSSpeechRecognitionUsageDescription'):
            if not str(info.get(permission, '')).strip():
                raise ValueError('Falta la descripción del permiso ' + permission)
        executable = info.get('CFBundleExecutable', '')
        if not executable or '/' in executable or '\\' in executable or executable in ('.', '..'):
            raise ValueError('CFBundleExecutable inválido')
        app_dir = infos[0].rsplit('/', 1)[0] + '/'
        if app_dir + 'main.jsbundle' not in names or not ipa.getinfo(app_dir + 'main.jsbundle').file_size:
            raise ValueError('Falta el bundle JavaScript de Release: no debe depender de Metro')
        inspected = []
        for name in names:
            if not name.startswith(app_dir) or name.endswith('/'):
                continue
            with ipa.open(name) as resource:
                magic = resource.read(4)
            if name == app_dir + executable or magic in (
                    b'\xcf\xfa\xed\xfe', b'\xca\xfe\xba\xbe', b'\xca\xfe\xba\xbf'):
                slices = inspect_macho(ipa.read(name))
                inspected.append({'path': name[len(app_dir):], 'slices': slices})
        if not any(item['path'] == executable for item in inspected):
            raise ValueError('No se encontró el ejecutable de la aplicación')
    with filename.open('rb') as source:
        sha256 = hashlib.file_digest(source, 'sha256').hexdigest()
    return {'filename': filename.name, 'bytes': filename.stat().st_size,
            'sha256': sha256,
            'version': version, 'buildNumber': info.get('CFBundleVersion'), 'bundleIdentifier': bundle_id,
            'minimumIOSVersion': info.get('MinimumOSVersion'), 'supportedPlatforms': ['iPhoneOS'],
            'binaries': inspected}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('ipa')
    parser.add_argument('--version', required=True)
    parser.add_argument('--bundle-id', required=True)
    args = parser.parse_args()
    print(json.dumps(verify_ipa(args.ipa, args.version, args.bundle_id), ensure_ascii=False, indent=2))
