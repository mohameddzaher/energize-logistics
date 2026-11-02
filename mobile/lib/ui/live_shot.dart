import 'dart:convert';
import 'package:image_picker/image_picker.dart';

/// A captured photo, not an uploaded one. `ImageSource.camera` opens the camera directly and never the gallery. This is intentional for the duty-start check: the photo is evidence compared with what the vehicle returned with, and a gallery upload could be yesterday's or another bike's photo. So `ImageSource.gallery` must not appear in this file.
class LiveShot {
  final String dataUrl;
  final String fileName;
  final int sizeBytes;
  const LiveShot(this.dataUrl, this.fileName, this.sizeBytes);
}

Future<LiveShot?> captureLivePhoto() async {
  final x = await ImagePicker().pickImage(
    source: ImageSource.camera,
    preferredCameraDevice: CameraDevice.rear,
    // A raw phone photo is about 4 MB and twenty riders each morning would fill the disk with no gain in clarity or network use, the narrowest link we have.
    maxWidth: 1280,
    maxHeight: 1280,
    imageQuality: 82,
  );
  if (x == null) return null;
  final bytes = await x.readAsBytes();
  return LiveShot(
    'data:image/jpeg;base64,${base64Encode(bytes)}',
    x.name.isEmpty ? 'duty.jpg' : x.name,
    bytes.length,
  );
}
