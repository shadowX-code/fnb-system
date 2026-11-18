// Browser decoding applies image orientation; the server independently verifies the final bytes.
export const INSTAGRAM_IMAGE_RECIPE='instagram-feed-jpeg-white-v1';
export function instagramImageGeometry(width,height){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>25000000)throw new Error('This image is too large to prepare safely. Export a PNG below 25 megapixels.');
 const ratio=width/height,target=Math.max(.8,Math.min(1.91,ratio));
 const outputWidth=Math.max(320,Math.min(1440,width));
 return {width:outputWidth,height:Math.max(Math.ceil(outputWidth/1.91),Math.min(Math.floor(outputWidth/.8),Math.round(outputWidth/target)))};
}
export async function prepareInstagramImage(blob){
 if(blob.type!=='image/png'||blob.size<24||blob.size>104857600)throw new Error('Choose a valid PNG up to 100 MB.');
 const header=new Uint8Array(await blob.slice(0,24).arrayBuffer());
 if(![137,80,78,71,13,10,26,10].every((v,i)=>header[i]===v))throw new Error('The file is not a valid PNG. Choose another image.');
 const view=new DataView(header.buffer);instagramImageGeometry(view.getUint32(16),view.getUint32(20));
 let image;
 try{
  image=await createImageBitmap(blob,{imageOrientation:'from-image'});
  const dimensions=instagramImageGeometry(image.width,image.height),canvas=document.createElement('canvas');
  canvas.width=dimensions.width;canvas.height=dimensions.height;
  const context=canvas.getContext('2d');if(!context)throw new Error('Image preparation is unavailable in this browser.');
  context.fillStyle='#ffffff';context.fillRect(0,0,canvas.width,canvas.height);
  const scale=Math.min(canvas.width/image.width,canvas.height/image.height),width=image.width*scale,height=image.height*scale;
  context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';
  context.drawImage(image,(canvas.width-width)/2,(canvas.height-height)/2,width,height);
  for(const quality of [.92,.86,.8]){
   const jpeg=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('JPEG preparation failed. Try selecting the image again.')),'image/jpeg',quality));
   if(jpeg.type==='image/jpeg'&&jpeg.size>0&&jpeg.size<=8388608)return jpeg;
  }
  throw new Error('The prepared image exceeds 8 MB. Export a smaller source image.');
 }catch(error){throw new Error(error.message||'The PNG could not be decoded. Export it again and retry.');}
 finally{image?.close();}
}
