import importlib.util
import plistlib
import struct
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('ios_personal', Path(__file__).parents[1] / 'scripts/verify-ios-personal.py')
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)


def macho(platform=2, cpu=0x0100000C):
    return struct.pack('<IIIIIIII', 0xFEEDFACF, cpu, 0, 2, 1, 24, 0, 0) + struct.pack('<IIIIII', 0x32, 24, platform, 0, 0, 0)


class PersonalIpaTests(unittest.TestCase):
    def make_ipa(self, folder, platform=2, cpu=0x0100000C, extra=None, **changes):
        info = {'CFBundleSupportedPlatforms': ['iPhoneOS'], 'CFBundleExecutable': 'AITheatre',
                'CFBundleIdentifier': 'com.kaiserrpp.aitheatre.prototype', 'CFBundleShortVersionString': '2026.11.251',
                'CFBundleVersion': '6', 'NSMicrophoneUsageDescription': 'Ensayar', 'NSSpeechRecognitionUsageDescription': 'Reconocer'}
        info.update(changes)
        filename = Path(folder) / 'test.ipa'
        with zipfile.ZipFile(filename, 'w') as package:
            package.writestr('Payload/AITheatre.app/Info.plist', plistlib.dumps(info))
            package.writestr('Payload/AITheatre.app/AITheatre', macho(platform, cpu))
            package.writestr('Payload/AITheatre.app/main.jsbundle', b'hermes-release-bundle')
            for name, data in (extra or {}).items():
                package.writestr(name, data)
        return filename

    def verify(self, filename):
        return verifier.verify_ipa(filename, '2026.11.251', 'com.kaiserrpp.aitheatre.prototype')

    def test_release_device_is_accepted_with_independent_hash(self):
        import hashlib
        with tempfile.TemporaryDirectory() as folder:
            filename = self.make_ipa(folder)
            result = self.verify(filename)
            self.assertEqual(result['supportedPlatforms'], ['iPhoneOS'])
            self.assertEqual(result['sha256'], hashlib.sha256(filename.read_bytes()).hexdigest())

    def test_arm64_simulator_cannot_pass_as_a_physical_iphone(self):
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaisesRegex(ValueError, 'simulador'):
                self.verify(self.make_ipa(folder, platform=7))

    def test_x86_binary_is_rejected_even_with_iphoneos_info(self):
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaisesRegex(ValueError, 'ARM64'):
                self.verify(self.make_ipa(folder, cpu=0x01000007))

    def test_simulator_framework_hidden_in_device_app_is_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaisesRegex(ValueError, 'simulador'):
                self.verify(self.make_ipa(folder, extra={'Payload/AITheatre.app/Frameworks/Wrong.framework/Wrong': macho(7)}))

    def test_credentials_and_path_traversal_are_rejected(self):
        for name in ['Payload/AITheatre.app/embedded.mobileprovision', 'Payload/AITheatre.app/.env.production', '../secret']:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as folder:
                with self.assertRaises(ValueError):
                    self.verify(self.make_ipa(folder, extra={name: b'not-allowed'}))

    def test_stale_version_and_missing_permission_are_rejected(self):
        for changes in [{'CFBundleShortVersionString': '2026.11.232'}, {'NSMicrophoneUsageDescription': ''}]:
            with self.subTest(changes=changes), tempfile.TemporaryDirectory() as folder:
                with self.assertRaises(ValueError):
                    self.verify(self.make_ipa(folder, **changes))

    def test_universal_binary_cannot_hide_a_simulator_slice(self):
        device, simulator = macho(), macho(7)
        header_size = 8 + 2 * 20
        header = struct.pack('>II', 0xCAFEBABE, 2)
        header += struct.pack('>IIIII', 0x0100000C, 0, header_size, len(device), 0)
        header += struct.pack('>IIIII', 0x0100000C, 0, header_size + len(device), len(simulator), 0)
        with self.assertRaisesRegex(ValueError, 'simulador'):
            verifier.inspect_macho(header + device + simulator)


if __name__ == '__main__':
    unittest.main()
