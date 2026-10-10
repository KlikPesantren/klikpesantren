#pragma once
#include <ArduinoJson.h>
#include <cstddef>
#include <cstdlib>

// ArduinoJson 7 legacy capacity constructors do NOT enforce an allocation limit.
// Include allocator headers in the budget, preserve the old block on failed realloc.
class AttendanceJsonAllocator : public ArduinoJson::Allocator {
 public:
  explicit AttendanceJsonAllocator(size_t limit) : limit_(limit) {}
  void* allocate(size_t size) override {
    if (!size || size > limit_ || sizeof(Header) > limit_ - size ||
        used_ > limit_ - size - sizeof(Header)) return nullptr;
    Header* h=static_cast<Header*>(std::malloc(size+sizeof(Header)));
    if (!h) return nullptr;
    h->size=size; used_+=size+sizeof(Header); if(used_>peak_)peak_=used_;
    return h+1;
  }
  void deallocate(void* ptr) override {
    if(!ptr)return; Header* h=static_cast<Header*>(ptr)-1;
    used_-=h->size+sizeof(Header); std::free(h);
  }
  void* reallocate(void* ptr,size_t size) override {
    if(!ptr)return allocate(size);
    if(!size){deallocate(ptr);return nullptr;}
    Header* h=static_cast<Header*>(ptr)-1;size_t old=h->size;
    if(size>limit_ || (size>old && size-old>limit_-used_))return nullptr;
    Header* next=static_cast<Header*>(std::realloc(h,size+sizeof(Header)));
    if(!next)return nullptr;
    next->size=size;used_=used_-old+size;if(used_>peak_)peak_=used_;
    return next+1;
  }
  size_t used() const{return used_;}
  size_t peak() const{return peak_;}
 private:
  struct alignas(std::max_align_t) Header{size_t size;};
  size_t limit_,used_=0,peak_=0;
};

class AttendanceBoundedJsonDocument : private AttendanceJsonAllocator, public JsonDocument {
 public:
  explicit AttendanceBoundedJsonDocument(size_t limit)
    : AttendanceJsonAllocator(limit),JsonDocument(static_cast<ArduinoJson::Allocator*>(this)) {}
};
