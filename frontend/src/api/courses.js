import axios from './axios';

export const getCourses = () => {
  return axios.get('/api/courses');
};