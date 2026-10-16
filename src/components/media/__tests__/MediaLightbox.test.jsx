import {it,expect,vi,afterEach} from 'vitest';
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import MediaLightbox from '../MediaLightbox.jsx';
afterEach(cleanup);
const image={id:'image',filename:'Image.jpg',mime_type:'image/jpeg'},video={id:'video',filename:'Video.mp4',mime_type:'video/mp4'};
it('supports image zoom, fit, gallery navigation and controlled non-autoplay video',async()=>{const resolver=vi.fn(async item=>'https://example.com/'+item.id);render(<MediaLightbox items={[image,video]} resolveSource={resolver} onClose={()=>{}}/>);await screen.findByRole('img',{name:'Image.jpg'});fireEvent.click(screen.getByRole('button',{name:'Zoom in'}));expect(screen.getByText('150%')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Fit to screen'}));expect(screen.getByText('100%')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Next media'}));await vi.waitFor(()=>expect(document.querySelector('video')?.getAttribute('src')).toBe('https://example.com/video'));expect(document.querySelector('video').controls).toBe(true);expect(document.querySelector('video').autoplay).toBe(false);expect(screen.queryByRole('img')).toBeNull();});
it('releases temporary Drive preview URLs and keeps credential errors out of the UI',async()=>{const release=vi.fn(),resolver=vi.fn().mockResolvedValueOnce({url:'blob:preview',release}).mockRejectedValueOnce(new Error('https://private.example/token=secret'));render(<MediaLightbox items={[image,video]} resolveSource={resolver} onClose={()=>{}}/>);await screen.findByRole('img');fireEvent.click(screen.getByRole('button',{name:'Next media'}));await screen.findByRole('alert');expect(release).toHaveBeenCalledTimes(1);expect(document.body.textContent).not.toContain('secret');});

it('renders PDF references in a sandbox without image zoom or autoplay',async()=>{
 const {container}=render(<MediaLightbox items={[{id:'pdf',filename:'Brief.pdf',mime_type:'application/pdf'}]} resolveSource={()=>Promise.resolve('blob:private-pdf')} onClose={()=>{}}/>);
 const frame=await screen.findByTitle('Brief.pdf');expect(frame.getAttribute('sandbox')).toBe('');expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');expect(screen.queryByRole('button',{name:'Zoom in'})).toBeNull();expect(container.querySelector('video')).toBeNull();
});
