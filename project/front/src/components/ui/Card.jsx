import React from 'react';
import './Card.css'; //CSS 따로 관리 중이라면

export default function Card({ children, className = '' }) {
  return (
    <div className={`Card ${className}`}>
      {children}
    </div>
  );
}