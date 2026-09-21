// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 jr200-web contributors
// All data are synthetic. No manufacturer ROM, fonts or commercial tapes.
#include "jr200/cjr.hpp"
#include <algorithm>
#include <functional>
#include <iostream>
#include <random>
#include <stdexcept>
#include <string>
#include <vector>
using namespace jr200::cjr;
using Buffer = std::vector<uint8_t>;
#define CHECK(x) do { if (!(x)) throw std::runtime_error(std::string(__FILE__) + ":" + std::to_string(__LINE__) + " " #x); } while (0)
extern "C" {
uint8_t* jr200_input_ptr(); uint8_t* jr200_output_ptr();
uint32_t jr200_inspect(uint32_t, uint32_t); uint32_t jr200_encode(uint32_t,uint32_t,uint32_t,uint32_t,uint32_t);
uint32_t jr200_summary_field(uint32_t); uint32_t jr200_output_size();
}
Bytes view(const Buffer& v) { return {v.data(), v.size()}; }
// Independently hand-calculated 47-byte golden: name X, MSAVE $7000..$7000, data AB.
Buffer golden() {
    return {0x02,0x2a,0x00,0x1a,0xff,0xff,
            0x58,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
            0x01,0x00,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0x95,
            0x02,0x2a,0x01,0x01,0x70,0x00,0xab,0x49,
            0x02,0x2a,0xff,0xff,0x70,0x01};
}
Buffer patterned(size_t n) { Buffer b(n); for (size_t i=0;i<n;++i) b[i]=uint8_t(i); return b; }
Buffer encode(const Buffer& data, uint16_t address=0x7000, bool basic=false, uint8_t baud=0) {
    const uint8_t name='X'; size_t written=0;
    CHECK(encode_binary({&name,1},view(data),address,basic,baud,{nullptr,0},written).error==Error::output_too_small);
    Buffer b(written);
    CHECK(encode_binary({&name,1},view(data),address,basic,baud,{b.data(),b.size()},written));
    CHECK(b.size()==written); return b;
}
void fix_sum(Buffer& b, size_t pos) {
    const size_t n = b.at(pos+3) ? b.at(pos+3) : 256;
    unsigned sum=0; for(size_t i=0;i<n+6;++i) sum+=b.at(pos+i);
    b.at(pos+n+6)=uint8_t(sum);
}
void count_visit(const Block&, void* p) { ++*static_cast<int*>(p); }
int main() {
    int count=0;
    auto test=[&](const char* name, const std::function<void()>& run) {
        run(); ++count; std::cout << "PASS " << name << '\n';
    };
    try {
        test("hand-calculated golden",[]{ auto g=golden(); CHECK(g.size()==47); CHECK(encode({0xab})==g); Summary s{}; CHECK(inspect(view(g),s)); CHECK(s.payload_bytes==1 && s.first_address==0x7000 && s.footer_address==0x7001 && s.warnings==0); });
        test("boundary lengths 1 255 256 257 511 512 513 65024",[]{for(size_t n : {1u,255u,256u,257u,511u,512u,513u,65024u}) { auto b=encode(patterned(n),0); Summary s{}; CHECK(inspect(view(b),s)); CHECK(s.payload_bytes==n); CHECK(s.data_blocks==(n+255)/256); CHECK(s.footer_address==n); CHECK(s.warnings==0); }});
        test("all 256 byte values",[]{auto data=patterned(256); auto b=encode(data); CHECK(b[36]==0); CHECK(std::equal(data.begin(),data.end(),b.begin()+39));});
        test("BASIC address and baud flag",[]{ auto b=encode({0,0,0},0x7000,true,1); Summary s{}; CHECK(inspect(view(b),s)); CHECK(s.first_address==0x801 && s.file_type==0 && s.baud_flag==1); });
        test("JR2Rescue 600 baud convention",[]{ auto b=encode({0xab},0x7000,false,kBaudFlag600); Summary s{}; CHECK(b[23]==100 && b[32]==0xf9); CHECK(inspect(view(b),s)); CHECK(s.baud_flag==kBaudFlag600); });
        test("every truncated prefix",[]{ auto b=golden(); for(size_t n=0;n<b.size();++n){ Summary s{}; CHECK(!inspect({b.data(),n},s)); }});
        test("header checksum",[]{ auto b=golden(); b[32]^=1; Summary s{}; auto r=inspect(view(b),s); CHECK(r.error==Error::bad_checksum && r.offset==32); });
        test("data checksum",[]{ auto b=golden(); b[40]^=1; Summary s{}; CHECK(inspect(view(b),s).error==Error::bad_checksum); });
        test("magic checks at each block",[]{ for(size_t pos:{0u,33u,41u}){auto b=golden();b[pos]=3;Summary s{};CHECK(inspect(view(b),s).error==Error::bad_magic);} });
        test("footer validation and trailing bytes",[]{ auto b=golden(); b[44]=0; Summary s{}; CHECK(inspect(view(b),s).error==Error::bad_footer); b=golden();b.push_back(0);CHECK(inspect(view(b),s).error==Error::trailing_data);b=golden();b.resize(41);CHECK(inspect(view(b),s).error==Error::missing_footer); });
        test("headerless is explicit",[]{auto b=golden();b.erase(b.begin(),b.begin()+33);Summary s{};CHECK(inspect(view(b),s).error==Error::header_required);CHECK(inspect(view(b),s,{true}));CHECK(!s.has_header && (s.warnings&Warning::headerless));});
        test("raw metadata is preserved",[]{auto b=golden();b[23]=0xfe;b[24]=0x12;fix_sum(b,0);Summary s{};CHECK(inspect(view(b),s));CHECK(s.baud_flag==0xfe);Buffer out(b.size());size_t size;CHECK(copy_verified(view(b),{out.data(),out.size()},size));CHECK(out==b);});
        test("sparse addresses remain sparse",[]{auto b=encode(patterned(257));const size_t second=33+263;b[second+4]=0xc0;b[second+5]=0;fix_sum(b,second);b[b.size()-2]=0xc0;b[b.size()-1]=1;Summary s{};CHECK(inspect(view(b),s));CHECK(s.warnings&Warning::noncontiguous_addresses);Buffer out(b.size());size_t n;CHECK(copy_verified(view(b),{out.data(),out.size()},n));CHECK(out==b);});
        test("sequence differences are reported",[]{auto b=golden();b[35]=4;fix_sum(b,33);Summary s{};CHECK(inspect(view(b),s));CHECK(s.warnings&Warning::nonsequential_blocks);});
        test("footer address differences are not rewritten",[]{auto b=golden();b.back()=0x77;Summary s{};CHECK(inspect(view(b),s));CHECK(s.warnings&Warning::footer_address_differs);});
        test("unknown type is preserved and warned",[]{auto b=golden();b[22]=0x88;fix_sum(b,0);Summary s{};CHECK(inspect(view(b),s));CHECK(s.file_type==0x88 && (s.warnings&Warning::unknown_file_type));});
        test("address overflow and upper boundary",[]{auto b=encode(patterned(256),0xff00);Summary s{};CHECK(inspect(view(b),s));CHECK(s.last_end_exclusive==65536 && s.footer_address==0);b[38]=1;fix_sum(b,33);CHECK(inspect(view(b),s).error==Error::address_overflow);});
        test("encoder argument checks and transactional output",[]{Buffer data(257),out(1000,0xcc);size_t n=0;const auto original=out;CHECK(encode_binary({nullptr,0},view(data),0xff00,false,0,{out.data(),out.size()},n).error==Error::address_overflow);CHECK(out==original);CHECK(encode_binary({nullptr,0},{nullptr,0},0,false,0,{out.data(),out.size()},n).error==Error::empty_payload);CHECK(encode_binary({out.data(),17},{out.data(),1},0,false,0,{nullptr,0},n).error==Error::name_too_long);CHECK(encode_binary({nullptr,0},view(data),0,false,0,{out.data(),1},n).error==Error::output_too_small);CHECK(out==original);});
        test("standard block-number limit",[]{auto data=patterned(65025);size_t n;CHECK(encode_binary({nullptr,0},view(data),0,false,0,{nullptr,0},n).error==Error::too_many_blocks);});
        test("input limit and null pointers",[]{Summary s{};auto b=golden();CHECK(inspect({b.data(),kMaxInput+1},s).error==Error::input_too_large);CHECK(inspect({nullptr,10},s).error==Error::null_buffer);});
        test("visitor has no partial callbacks",[]{auto b=golden();int calls=0;CHECK(visit(view(b),count_visit,&calls));CHECK(calls==3);calls=0;b[40]^=1;CHECK(!visit(view(b),count_visit,&calls));CHECK(calls==0);});
        test("summary unchanged on failed parse",[]{Summary s{};s.payload_bytes=1234;auto b=golden();b[0]=0;CHECK(!inspect(view(b),s));CHECK(s.payload_bytes==1234);});
        test("no-data and noncanonical header warnings",[]{auto b=golden();b.erase(b.begin()+33,b.begin()+41);b[4]=0;fix_sum(b,0);Summary s{};CHECK(inspect(view(b),s));CHECK((s.warnings&Warning::no_data_blocks)&&(s.warnings&Warning::noncanonical_header_address));});
        test("C ABI validates browser-controlled arguments",[]{auto b=golden();std::copy(b.begin(),b.end(),jr200_input_ptr());CHECK(jr200_inspect(uint32_t(b.size()),0)==0);CHECK(jr200_summary_field(4)==1);CHECK(jr200_inspect(uint32_t(kMaxInput+1),0)==uint32_t(Error::input_too_large));CHECK(jr200_summary_field(4)==0);CHECK(jr200_encode(1,1,65536,0,0)==uint32_t(Error::bad_argument));auto* p=jr200_input_ptr();p[0]='X';p[16]=0xab;CHECK(jr200_encode(1,1,0x7000,0,0)==0);CHECK(jr200_output_size()==47);CHECK(std::equal(b.begin(),b.end(),jr200_output_ptr()));});
        test("12000 deterministic malformed and mutated inputs",[]{std::mt19937 random(0x200);for(int i=0;i<12000;++i){Buffer b;if(i%2){b=encode(patterned(size_t(1+random()%513)));for(unsigned k=0;k<1+random()%4;++k)b[random()%b.size()]^=uint8_t(random());}else{b.resize(random()%600);for(auto& v:b)v=uint8_t(random());}Summary s{};auto r=inspect(view(b),s,{true});if(r){Buffer out(b.size());size_t n;CHECK(copy_verified(view(b),{out.data(),out.size()},n,{true}));CHECK(out==b);int calls=0;CHECK(visit(view(b),count_visit,&calls,{true}));CHECK(calls==int(s.data_blocks)+(s.has_header?1:0)+1);}}});
        std::cout << count << " test groups passed\n"; return 0;
    } catch(const std::exception& e) {std::cerr << "FAIL " << e.what() << '\n';return 1;}
}
