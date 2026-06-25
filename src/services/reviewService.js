const mongoose = require('mongoose');
const Review = require('../models/Review');
const Product = require('../models/Product');
const Order = require('../models/Order');
const { withMongoTransaction } = require('../utils/transaction');

async function updateProductRating(productId, session) {
  const stats = await Review.aggregate([
    { $match: { product: new mongoose.Types.ObjectId(productId), isPublished: true } },
    { $group: { _id: '$product', average: { $avg: '$rating' }, count: { $sum: 1 } } }
  ]).session(session);
  await Product.updateOne(
    { _id: productId },
    { averageRating: stats[0]?.average || 0, reviewCount: stats[0]?.count || 0 },
    { session }
  );
}

async function createVerifiedReview({ userId, productId, rating, comment }) {
  return withMongoTransaction(async (session) => {
    const order = await Order.findOne({
      user: userId,
      status: 'completed',
      'items.product': productId
    }).sort({ completedAt: -1 }).session(session);
    if (!order) {
      const error = new Error('Ulasan hanya dapat diberikan setelah pembelian terverifikasi.');
      error.status = 403;
      throw error;
    }

    const [review] = await Review.create([{
      user: userId,
      product: productId,
      order: order._id,
      rating,
      comment
    }], { session });
    await updateProductRating(productId, session);
    return { review, order };
  });
}

async function toggleReviewPublication(reviewId) {
  return withMongoTransaction(async (session) => {
    const review = await Review.findById(reviewId).session(session);
    if (!review) return null;
    review.isPublished = !review.isPublished;
    await review.save({ session });
    await updateProductRating(review.product, session);
    return review;
  });
}

module.exports = { createVerifiedReview, toggleReviewPublication, updateProductRating };
