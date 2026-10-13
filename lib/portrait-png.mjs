import {inflateSync,deflateSync} from 'node:zlib';
import {ApiError} from './errors.mjs';

const signature=Buffer.from([137,80,78,71,13,10,26,10]);
const bad=()=>{throw new ApiError('生图服务返回了无法处理的 PNG，请重试。',502,'IMAGE_FORMAT')};
const crcTable=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0});
function crc(bytes){let n=0xffffffff;for(const v of bytes)n=crcTable[(n^v)&255]^(n>>>8);return (n^0xffffffff)>>>0}
function chunk(name,bytes){const type=Buffer.from(name),out=Buffer.alloc(bytes.length+12);out.writeUInt32BE(bytes.length);type.copy(out,4);bytes.copy(out,8);out.writeUInt32BE(crc(Buffer.concat([type,bytes])),bytes.length+8);return out}

// Only bounded, non-interlaced 8-bit PNGs. Decode filters before checking real alpha,
// so an opaque RGBA image or a painted checkerboard is not mistaken for transparency.
export function decodePortraitPng(bytes){
 if(!Buffer.isBuffer(bytes)||bytes.length>12_000_000||!bytes.subarray(0,8).equals(signature))bad();
 let header,palette,transparency,ended=false;const parts=[];
 for(let pos=8;pos<bytes.length;){
  if(pos+12>bytes.length)bad();
  const length=bytes.readUInt32BE(pos),end=pos+12+length;
  if(end>bytes.length)bad();
  const type=bytes.toString('ascii',pos+4,pos+8),data=bytes.subarray(pos+8,pos+8+length);
  if(crc(bytes.subarray(pos+4,pos+8+length))!==bytes.readUInt32BE(pos+8+length))bad();
  if(type==='IHDR'){if(header||pos!==8||length!==13)bad();header=data}
  else if(type==='PLTE')palette=data;
  else if(type==='tRNS')transparency=data;
  else if(type==='IDAT')parts.push(data);
  else if(type==='IEND'){ended=true;break}
  pos=end;
 }
 if(!header||!parts.length||!ended)bad();
 const width=header.readUInt32BE(0),height=header.readUInt32BE(4),kind=header[9];
 const channels=({0:1,2:3,3:1,4:2,6:4})[kind];
 if(!width||!height||width*height>8_388_608||header[8]!==8||!channels||header[10]||header[11]||header[12])bad();
 const stride=width*channels,expected=(stride+1)*height;
 let raw;try{raw=inflateSync(Buffer.concat(parts),{maxOutputLength:expected})}catch{bad()}
 if(raw.length!==expected)bad();
 const pixels=Buffer.alloc(width*height*4);let previous=Buffer.alloc(stride),at=0;
 const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c};
 for(let y=0;y<height;y++){
  const filter=raw[at++],row=Buffer.from(raw.subarray(at,at+stride));at+=stride;if(filter>4)bad();
  for(let x=0;x<stride;x++){
   const a=x>=channels?row[x-channels]:0,b=previous[x],c=x>=channels?previous[x-channels]:0;
   row[x]=(row[x]+([0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][filter]))&255;
  }
  for(let x=0;x<width;x++){
   const src=x*channels,dst=(y*width+x)*4;
   let r,g,b,alpha=255;
   if(kind===6){[r,g,b,alpha]=row.subarray(src,src+4)}
   else if(kind===4){r=g=b=row[src];alpha=row[src+1]}
   else if(kind===3){const i=row[src];if(!palette||i*3+2>=palette.length)bad();[r,g,b]=palette.subarray(i*3,i*3+3);alpha=transparency?.[i]??255}
   else if(kind===2){[r,g,b]=row.subarray(src,src+3);if(transparency?.length===6&&r===transparency.readUInt16BE(0)&&g===transparency.readUInt16BE(2)&&b===transparency.readUInt16BE(4))alpha=0}
   else {r=g=b=row[src];if(transparency?.length===2&&r===transparency.readUInt16BE(0))alpha=0}
   pixels[dst]=r;pixels[dst+1]=g;pixels[dst+2]=b;pixels[dst+3]=alpha;
  }
  previous=row;
 }
 return {width,height,pixels};
}

export function encodePortraitPng({width,height,pixels}){
 const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
 const raw=Buffer.alloc((width*4+1)*height);
 for(let y=0;y<height;y++)pixels.copy(raw,y*(width*4+1)+1,y*width*4,(y+1)*width*4);
 return Buffer.concat([signature,chunk('IHDR',header),chunk('IDAT',deflateSync(raw,{level:9})),chunk('IEND',Buffer.alloc(0))]);
}

function resize(image,width,height){
 const pixels=Buffer.alloc(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const sx=(x+0.5)*image.width/width-0.5,sy=(y+0.5)*image.height/height-0.5;
  const x0=Math.max(0,Math.floor(sx)),y0=Math.max(0,Math.floor(sy)),dx=Math.max(0,sx-x0),dy=Math.max(0,sy-y0);
  const samples=[[x0,y0,(1-dx)*(1-dy)],[Math.min(image.width-1,x0+1),y0,dx*(1-dy)],[x0,Math.min(image.height-1,y0+1),(1-dx)*dy],[Math.min(image.width-1,x0+1),Math.min(image.height-1,y0+1),dx*dy]];
  let alpha=0;const rgb=[0,0,0];
  for(const [px,py,w] of samples){const i=(py*image.width+px)*4,a=image.pixels[i+3]*w;alpha+=a;for(let c=0;c<3;c++)rgb[c]+=image.pixels[i+c]*a}
  const dst=(y*width+x)*4;pixels[dst+3]=Math.round(alpha);for(let c=0;c<3;c++)pixels[dst+c]=alpha?Math.round(rgb[c]/alpha):0;
 }
 return {width,height,pixels};
}

export function prepareGeneratedPortrait(bytes,maxBytes=2_000_000){
 const image=decodePortraitPng(bytes);let transparent=0,visible=0;
 for(let i=3;i<image.pixels.length;i+=4){if(image.pixels[i]<255)transparent++;if(image.pixels[i]>0)visible++}
 if(!visible||transparent/(image.width*image.height)<0.01)throw new ApiError('模型未生成有效的透明背景立绘，请手动重试；此次结果没有覆盖原图。',502,'IMAGE_ALPHA');
 let result=encodePortraitPng(image),output=image;
 while(result.length>maxBytes){
  const width=Math.max(1,Math.floor(output.width*0.8)),height=Math.max(1,Math.floor(output.height*0.8));
  if(width===output.width&&height===output.height)bad();
  output=resize(image,width,height);result=encodePortraitPng(output);
 }
 return {bytes:result,width:output.width,height:output.height};
}
