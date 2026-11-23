// Minimal PNG decoder: 8-bit greyscale, RGB, palette, grey+alpha and RGBA, non-interlaced.
// That covers everything Chrome's Page.captureScreenshot produces. Output is always RGBA.
import {inflateSync} from 'node:zlib';

const SIGNATURE=Buffer.from([137,80,78,71,13,10,26,10]);
const CHANNELS={0:1,2:3,3:1,4:2,6:4};

/** @returns {{width:number,height:number,data:Uint8Array}} data is RGBA, row-major. */
export function decodePng(buffer) {
  const buf=Buffer.isBuffer(buffer)?buffer:Buffer.from(buffer);
  if(buf.length<8||!buf.subarray(0,8).equals(SIGNATURE))throw new Error('Not a PNG file.');
  let offset=8,width=0,height=0,depth=0,type=0,interlace=0,palette=null,trns=null;
  const idat=[];
  while(offset+8<=buf.length) {
    const length=buf.readUInt32BE(offset),kind=buf.toString('latin1',offset+4,offset+8);
    const body=buf.subarray(offset+8,offset+8+length);
    offset+=12+length;
    if(kind==='IHDR'){width=body.readUInt32BE(0);height=body.readUInt32BE(4);depth=body[8];type=body[9];interlace=body[12];}
    else if(kind==='PLTE')palette=body;
    else if(kind==='tRNS')trns=body;
    else if(kind==='IDAT')idat.push(body);
    else if(kind==='IEND')break;
  }
  if(!width||!height)throw new Error('PNG has no IHDR chunk.');
  if(depth!==8)throw new Error('Only 8-bit PNGs are supported (got '+depth+').');
  if(interlace)throw new Error('Interlaced PNGs are not supported.');
  const channels=CHANNELS[type];
  if(!channels)throw new Error('Unsupported PNG colour type '+type+'.');
  const raw=inflateSync(Buffer.concat(idat));
  const stride=width*channels,bpp=channels;
  if(raw.length<(stride+1)*height)throw new Error('PNG image data is truncated.');
  const pixels=new Uint8Array(stride*height);
  for(let y=0;y<height;y++) {
    const filter=raw[y*(stride+1)],src=y*(stride+1)+1,dst=y*stride,prev=dst-stride;
    for(let x=0;x<stride;x++) {
      const v=raw[src+x];
      const a=x>=bpp?pixels[dst+x-bpp]:0;
      const b=y>0?pixels[prev+x]:0;
      const c=x>=bpp&&y>0?pixels[prev+x-bpp]:0;
      let out;
      switch(filter){
        case 0:out=v;break;
        case 1:out=v+a;break;
        case 2:out=v+b;break;
        case 3:out=v+((a+b)>>1);break;
        case 4:{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);out=v+(pa<=pb&&pa<=pc?a:pb<=pc?b:c);break;}
        default:throw new Error('Bad PNG filter '+filter+'.');
      }
      pixels[dst+x]=out&255;
    }
  }
  if(type===6)return {width,height,data:pixels};
  const data=new Uint8Array(width*height*4);
  for(let i=0,j=0;i<width*height;i++,j+=channels) {
    let r,g,b,a=255;
    if(type===0){r=g=b=pixels[j];}
    else if(type===4){r=g=b=pixels[j];a=pixels[j+1];}
    else if(type===2){r=pixels[j];g=pixels[j+1];b=pixels[j+2];}
    else {const k=pixels[j]*3;r=palette[k];g=palette[k+1];b=palette[k+2];if(trns&&pixels[j]<trns.length)a=trns[pixels[j]];}
    data[i*4]=r;data[i*4+1]=g;data[i*4+2]=b;data[i*4+3]=a;
  }
  return {width,height,data};
}
