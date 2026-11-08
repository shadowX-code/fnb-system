import { reviewInboxPayload, validateGoogleReview } from './googleBusinessProfile.ts';
import type { GoogleReviewRecord } from './googleReviewsContract.ts';

const stars = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

export function guestVoiceProjection(value: unknown, location: string) {
  const { reviews, googleAggregate } = reviewInboxPayload(value, location);
  if (googleAggregate && googleAggregate.totalReviewCount !== reviews.length) {
    throw new Error('Incomplete Google review cache.');
  }
  return {
    rating: googleAggregate?.averageRating ?? null,
    total: googleAggregate?.totalReviewCount ?? null,
    reviews: (reviews as GoogleReviewRecord[]).map((row: GoogleReviewRecord) => {
      validateGoogleReview(row, location);
      return {
        id: row.name.slice(location.length + '/reviews/'.length),
        reviewer: row.reviewer?.isAnonymous ? { isAnonymous: true } : {
          displayName: row.reviewer?.displayName,
          profilePhotoUrl: row.reviewer?.profilePhotoUrl,
        },
        rating: stars[row.starRating],
        date: row.createTime,
        comment: row.comment || '',
      };
    }).sort((a, b) => Date.parse(b.date) - Date.parse(a.date) || a.id.localeCompare(b.id)),
  };
}
