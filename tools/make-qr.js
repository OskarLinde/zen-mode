// macOS built-in Core Image QR generator; no network or third-party packages.
ObjC.import('Foundation');
ObjC.import('CoreImage');
ObjC.import('CoreGraphics');
ObjC.import('AppKit');
function run(argv) {
  if (argv.length !== 1) throw new Error('Expected one URL');
  var filter = $.CIFilter.filterWithName('CIQRCodeGenerator');
  filter.setValueForKey($(argv[0]).dataUsingEncoding($.NSUTF8StringEncoding), 'inputMessage');
  filter.setValueForKey($('M'), 'inputCorrectionLevel');
  var qr = filter.outputImage;
  var extent = qr.extent;
  var white = $.CIImage.imageWithColor($.CIColor.colorWithRedGreenBlueAlpha(1, 1, 1, 1));
  var canvas = white.imageByCroppingToRect($.CGRectMake(0, 0, extent.size.width + 8, extent.size.height + 8));
  qr = qr.imageByApplyingTransform($.CGAffineTransformMakeTranslation(4 - extent.origin.x, 4 - extent.origin.y));
  var image = qr.imageByCompositingOverImage(canvas).imageByApplyingTransform($.CGAffineTransformMakeScale(8, 8));
  var bitmap = $.NSBitmapImageRep.alloc.initWithCIImage(image);
  var png = bitmap.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $({}));
  return ObjC.unwrap(png.base64EncodedStringWithOptions(0));
}
