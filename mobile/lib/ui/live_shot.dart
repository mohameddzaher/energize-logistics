import 'dart:convert';
import 'package:image_picker/image_picker.dart';

/// صورةٌ مُلتقَطة — لا مرفوعة.
///
/// `ImageSource.camera` تفتح الكاميرا مباشرةً ولا تفتح المعرض أصلًا. وهذا هو
/// المقصود في تفقّد بداية الدوام: الصورةُ هناك حجّةٌ تُقارَن بما رجعت به
/// المركبة، فلو جاز رفعُها من المعرض جاز أن تكون صورةَ أمسِ أو صورةَ درّاجةٍ
/// أخرى — ويصير السجلُّ ورقةً تُملأ من المكتب.
///
/// ولذلك لا يوجد في هذا الملفّ `ImageSource.gallery` ولا ينبغي أن يُضاف.
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
    // صورةُ الهاتف الخام أربعةُ ميغابايت، وعشرون مندوبًا كلَّ صباحٍ يملؤون
    // القرصَ بلا فائدةٍ في الوضوح — ولا في الشبكة، وهي أضيقُ ما عندنا.
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
