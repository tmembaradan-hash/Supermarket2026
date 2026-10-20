// Test the real bundled decoder on raster images. Does not emulate camera hardware.
const fs=require('node:fs'),assert=require('node:assert/strict');
const source=fs.readFileSync(__dirname+'/../vendor/html5-qrcode.min.js','utf8');
const app=fs.readFileSync(__dirname+'/../app.js','utf8');
const lib=new Function('window','document','performance',source.slice(0,source.lastIndexOf('if (window)'))+';return __Html5QrcodeLibrary__;')({}, {getElementById:()=>({})},{now:()=>Date.now()});
const scan=new lib.Html5Qrcode('reader',{formatsToSupport:[lib.Html5QrcodeSupportedFormats.EAN_13,lib.Html5QrcodeSupportedFormats.EAN_8,lib.Html5QrcodeSupportedFormats.UPC_A],useBarCodeDetectorIfSupported:false});
const {L,G,parity,R}={"L":["0001101","0011001","0010011","0111101","0100011","0110001","0101111","0111011","0110111","0001011"],"G":["0100111","0110011","0011011","0100001","0011101","0111001","0000101","0010001","0001001","0010111"],"parity":["LLLLLL","LLGLGG","LLGGLG","LLGGGL","LGLLGG","LGGLLG","LGGGLL","LGLGLG","LGLGGL","LGGLGL"],"R":["1110010","1100110","1101100","1000010","1011100","1001110","1010000","1000100","1001000","1110100"]};
function canvas(bits){
 bits='000000000000'+bits+'000000000000';
 const width=bits.length*3,height=120,data=new Uint8ClampedArray(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const c=bits[Math.floor(x/3)]==='1'?0:255,at=(y*width+x)*4;data[at]=data[at+1]=data[at+2]=c;data[at+3]=255;}
 return {width,height,getContext:()=>({getImageData:()=>({data})})};
}
function bits13(code){let b='101';for(let i=1;i<7;i++)b+=(parity[+code[0]][i-1]==='L'?L:G)[+code[i]];b+='01010';for(let i=7;i<13;i++)b+=R[+code[i]];return b+'101';}
(async()=>{
 for(const code of ['4006381333931','5901234123457','0123456789012','96385074']){
  const bits=code.length===8?'101'+code.slice(0,4).split('').map(x=>L[+x]).join('')+'01010'+code.slice(4).split('').map(x=>R[+x]).join('')+'101':bits13(code);
  const result=await scan.qrcode.decodeAsync(canvas(bits));
  assert.equal(result.text,code==='0123456789012'?'123456789012':code);
 }
 const digits=app.split('\n').find(x=>x.startsWith('const englishDigits='));
 const helper=app.slice(app.indexOf('function barcodeKey('),app.indexOf('function lookupBarcode('));
 const records={a:{id:'a',barcode:'0123456789012'},b:{id:'b',barcode:'001234'}};
 const lookup=new Function('state',digits+helper+';return findBarcodeProduct;')({products:records});
 assert.equal(lookup('123456789012').id,'a');assert.equal(lookup('٠١٢٣٤٥٦٧٨٩٠١٢').id,'a');
 assert.equal(lookup('001234').id,'b');assert.equal(lookup('1234'),undefined);assert.equal(records.a.barcode,'0123456789012');
 console.log('PASS four real barcode raster decodes and five barcode matching checks; camera hardware not tested.');
})().catch(err=>{console.error(err);process.exitCode=1;});
