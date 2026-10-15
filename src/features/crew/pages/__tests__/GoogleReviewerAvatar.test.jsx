import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import GoogleReviewerAvatar from '../../components/GoogleReviewerAvatar.jsx';

afterEach(cleanup);
describe('Google reviewer avatar', () => {
  it('uses the existing provider URL and falls back after failure, retrying a changed URL', () => {
    const reviewer = { displayName: 'Jane Doe', profilePhotoUrl: 'https://lh3.googleusercontent.com/reviewer' };
    const { container, rerender } = render(<GoogleReviewerAvatar reviewer={reviewer} />);
    const image = container.querySelector('img');
    expect(image.getAttribute('src')).toBe(reviewer.profilePhotoUrl);
    expect(image.getAttribute('referrerpolicy')).toBe('no-referrer');
    fireEvent.error(image);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe('JD');
    rerender(<GoogleReviewerAvatar reviewer={{ ...reviewer, profilePhotoUrl: `${reviewer.profilePhotoUrl}-new` }} />);
    expect(container.querySelector('img').getAttribute('src')).toBe(`${reviewer.profilePhotoUrl}-new`);
  });
  it('shows initials when the photo is absent or not HTTPS', () => {
    const { container, rerender } = render(<GoogleReviewerAvatar reviewer={{ displayName: '李 明' }} />);
    expect(container.textContent).toBe('李明');
    rerender(<GoogleReviewerAvatar reviewer={{ displayName: 'Lee', profilePhotoUrl: 'http://example.com/photo' }} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe('L');
  });
  it('uses an anonymous fallback without loading a photo', () => {
    const { container, rerender } = render(<GoogleReviewerAvatar reviewer={{ isAnonymous: true, displayName: 'Private', profilePhotoUrl: 'https://example.com/photo' }} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).toBeTruthy();
    rerender(<GoogleReviewerAvatar />);
    expect(container.querySelector('svg')).toBeTruthy();
  });
});
