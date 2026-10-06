import { Navigate, useLocation } from 'react-router-dom';

export default function ShiftCurrent(){
  const location=useLocation();
  return <Navigate to={`/shifts${location.search}`} replace/>;
}
