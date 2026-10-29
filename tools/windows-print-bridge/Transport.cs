using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Printing;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

// Only this class knows printer protocols. Cloud jobs contain pixels, never executable commands.
public static class FeedXTransport {
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
 public class DocInfo { [MarshalAs(UnmanagedType.LPWStr)] public string Name; [MarshalAs(UnmanagedType.LPWStr)] public string Output; [MarshalAs(UnmanagedType.LPWStr)] public string Type="RAW"; }
 [DllImport("winspool.drv",EntryPoint="OpenPrinterW",SetLastError=true,CharSet=CharSet.Unicode)] static extern bool OpenPrinter(string name,out IntPtr handle,IntPtr defaults);
 [DllImport("winspool.drv",SetLastError=true)] static extern bool ClosePrinter(IntPtr handle);
 [DllImport("winspool.drv",EntryPoint="StartDocPrinterW",SetLastError=true,CharSet=CharSet.Unicode)] static extern int StartDocPrinter(IntPtr handle,int level,[In] DocInfo info);
 [DllImport("winspool.drv",SetLastError=true)] static extern bool EndDocPrinter(IntPtr handle);
 [DllImport("winspool.drv",SetLastError=true)] static extern bool WritePrinter(IntPtr handle,byte[] data,int count,out int written);
 [DllImport("winspool.drv",SetLastError=true)] static extern bool AbortPrinter(IntPtr handle);
 static void Check(bool ok) { if(!ok) throw new IOException("Windows spooler error " + Marshal.GetLastWin32Error()); }
 public static byte[] Tspl(byte[] blackBits,int width,int height,decimal widthMm,decimal heightMm,int copies,decimal gapMm,bool invert) {
  Validate(blackBits,width,height,widthMm,heightMm,copies);
  if(gapMm<0 || gapMm>10) throw new ArgumentException("Gap must be 0–10 mm.");
  var culture=System.Globalization.CultureInfo.InvariantCulture;
  var header="SIZE "+widthMm.ToString(culture)+" mm,"+heightMm.ToString(culture)+" mm\r\nGAP "+gapMm.ToString(culture)+" mm,0\r\nDIRECTION 1\r\nCLS\r\nBITMAP 0,0,"+((width+7)/8)+","+height+",0,";
  using(var stream=new MemoryStream()) {
   var data=Encoding.ASCII.GetBytes(header);stream.Write(data,0,data.Length);
   foreach(byte b in blackBits) stream.WriteByte(invert ? (byte)~b : b);
   data=Encoding.ASCII.GetBytes("\r\nPRINT 1,"+copies+"\r\n");stream.Write(data,0,data.Length);return stream.ToArray();
  }
 }
 static void Validate(byte[] data,int width,int height,decimal wm,decimal hm,int copies) {
  if(wm<20 || wm>120 || hm<20 || hm>200 || width!=(int)Math.Round(wm*203m/25.4m,MidpointRounding.AwayFromZero) || height!=(int)Math.Round(hm*203m/25.4m,MidpointRounding.AwayFromZero) || copies<1 || copies>10000 || data==null || data.Length!=((width+7)/8)*height) throw new ArgumentException("Invalid label bitmap or dimensions.");
 }
 public static int Raw(string printer,byte[] command,string name) {
  IntPtr handle;Check(OpenPrinter(printer,out handle,IntPtr.Zero));bool started=false;
  try {
   int job=StartDocPrinter(handle,1,new DocInfo{Name=name});Check(job>0);started=true;
   int written;Check(WritePrinter(handle,command,command.Length,out written));
   if(written!=command.Length)throw new IOException("Partial printer write; output is uncertain.");
   Check(EndDocPrinter(handle));started=false;return job;
  } finally {if(started)AbortPrinter(handle);ClosePrinter(handle);}
 }
 public static void Spool(string printer,byte[] data,int width,int height,decimal wm,decimal hm,int copies,string name) {
  Validate(data,width,height,wm,hm,copies);
  using(var bitmap=new Bitmap(width,height)) using(var doc=new PrintDocument()) {
   bitmap.SetResolution(203,203);int stride=(width+7)/8;
   for(int y=0;y<height;y++)for(int x=0;x<width;x++)bitmap.SetPixel(x,y,(data[y*stride+x/8]&(128>>(x%8)))!=0 ? Color.Black : Color.White);
   doc.PrinterSettings.PrinterName=printer;
   if(!doc.PrinterSettings.IsValid) throw new ArgumentException("Configured Windows printer is unavailable.");
   doc.DocumentName=name;doc.PrintController=new StandardPrintController();
   doc.DefaultPageSettings.PaperSize=new PaperSize("FeedX label",(int)Math.Round(wm*100m/25.4m),(int)Math.Round(hm*100m/25.4m));
   doc.DefaultPageSettings.Margins=new Margins(0,0,0,0);doc.DefaultPageSettings.Landscape=false;doc.OriginAtMargins=false;
   int page=0;
   doc.PrintPage+=(sender,e)=>{
    // The driver owns hard margins. Cancel instead of silently scaling or clipping content.
    var area=e.PageSettings.PrintableArea;
    float w=(float)(wm*100m/25.4m),h=(float)(hm*100m/25.4m);
    if(area.Width+1<w || area.Height+1<h)throw new InvalidOperationException("Driver cannot expose the full label area. Configure borderless label media.");
    e.Graphics.TranslateTransform(-e.PageSettings.HardMarginX,-e.PageSettings.HardMarginY);
    e.Graphics.InterpolationMode=InterpolationMode.NearestNeighbor;e.Graphics.PixelOffsetMode=PixelOffsetMode.Half;
    e.Graphics.DrawImage(bitmap,new RectangleF(0,0,w,h));e.HasMorePages=++page<copies;
   };
   doc.Print(); // Spooler acceptance is Sent; physical confirmation belongs to the operator.
  }
 }
}
