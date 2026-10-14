import test from 'node:test'
import assert from 'node:assert/strict'
import {photoUrl} from '../utils/photo.js'
import {readFile} from 'node:fs/promises'
test('受保护照片仅请求本系统文件地址，拒绝外站及路径穿越',()=>{
  assert.ok(photoUrl('/api/files/photo.png').endsWith('/api/files/photo.png'))
  assert.ok(photoUrl('/api/contracts/c1/attachments/a1/file').endsWith('/api/contracts/c1/attachments/a1/file'))
  for(const value of ['https://example.com/photo','/files/../private','javascript:alert(1)','/contracts/c1/attachments','/contracts/c1/attachments/a1/file?token=bad','/contracts/../attachments/a1/file',null])assert.equal(photoUrl(value),null)
})
test('照片带鉴权下载到本地后再预览，不使用裸公开图片链接',async()=>{
  const url=new URL('../components/ProtectedPhoto.vue',import.meta.url)
  const source=await readFile(url,'utf8')
  const script=source.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/from '([^']+)'/g,(_,path)=>`from '${new URL(path,url).href}'`)
  const page=(await import(`data:text/javascript;base64,${Buffer.from(script).toString('base64')}`)).default
  let downloaded,preview
  globalThis.uni={getStorageSync:()=> 'test-token',downloadFile:options=>{downloaded=options;options.success({statusCode:200,tempFilePath:'/cache/photo.png'});options.complete()},previewImage:options=>{preview=options}}
  const vm={...page.data(),url:'/api/files/photo.png'}
  for(const [key,method] of Object.entries(page.methods))vm[key]=method.bind(vm)
  await vm.load();vm.preview()
  assert.equal(downloaded.header.Authorization,'Bearer test-token')
  assert.equal(downloaded.timeout,15000)
  assert.equal(vm.source,'/cache/photo.png')
  assert.deepEqual(preview.urls,['/cache/photo.png'])
  vm.url='/api/contracts/c1/attachments/a1/file'
  await vm.load()
  assert.ok(downloaded.url.endsWith('/contracts/c1/attachments/a1/file'))
  assert.equal(downloaded.header.Authorization,'Bearer test-token')
  uni.downloadFile=options=>{options.success({statusCode:404});options.complete()}
  await vm.load()
  assert.equal(vm.source,'');assert.equal(vm.loading,false);assert.equal(vm.failure,'原文件缺失或不可访问')
})
